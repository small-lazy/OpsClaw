"""In-process persistent worker. API process must remain running."""
from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timedelta, timezone

from . import store, growth_actions as actions, growth_monitor as monitor
from .service import DomainError


def tick():
    now = datetime.now(timezone.utc)
    owner = secrets.token_hex(12)
    with store.transaction() as connection:
        p = monitor.policy(connection)
        if not p['worker_enabled']:
            return {'status': 'disabled'}
        lease = store.meta(connection, 'growth_worker_lease') or {}
        if lease.get('until') and datetime.fromisoformat(lease['until']) > now:
            return {'status': 'busy'}
        store.set_meta(connection, 'growth_worker_lease', {'owner': owner, 'until': (now + timedelta(minutes=10)).isoformat()})
    errors, completed = [], []
    try:
        from .growth_collector import poll
        from .growth_api import latest_analysis
        result = poll()
        if result.get('status') == 'error':
            errors.append((result.get('error') or {}).get('code', 'COLLECTOR_FAILED'))
        if result.get('imported') or result.get('updated'):
            with store.transaction() as connection:
                latest_analysis(connection)
        with store.connect() as connection:
            factors = [f for f in monitor.records(connection, 'factor') if f['status'] == 'active' and
                       (not f.get('next_check_at') or datetime.fromisoformat(f['next_check_at']) <= now)]
        for factor in sorted(factors, key=lambda f: f.get('next_check_at') or '')[:3]:
            try:
                monitor.monitor_one(factor['id'])
                completed.append(factor['id'])
            except DomainError as error:
                errors.append(error.code)
        with store.transaction() as connection:
            if p['auto_propose'] and not p['kill_switch']:
                for event in monitor.records(connection, 'event'):
                    if event['status'] != 'approved' or event.get('proposal_id') or not event.get('factor_id'):
                        continue
                    factor = monitor.get(connection, 'factor', event['factor_id'])
                    params = factor.get('action_parameters')
                    if factor['status'] != 'active' or not params:
                        continue
                    try:
                        proposal = actions.propose(connection, event, params)
                        event['proposal_id'] = proposal['id']
                        monitor.put(connection, 'event', event)
                    except DomainError as error:
                        errors.append(error.code)
            current = actions.list_actions(connection)
        for action in current:
            try:
                if action['status'] in ('approved', 'blocked_configuration') and not p['kill_switch']:
                    actions.execute(action['id'])
                elif action['status'] in ('unknown', 'running'):
                    actions.reconcile(action['id'])
                elif action['status'] == 'succeeded' and action['kind'] == 'create_campaign':
                    with store.transaction() as connection:
                        key = 'growth_performance_poll:' + action['id']
                        last = store.meta(connection, key)
                        if last and datetime.fromisoformat(last) > now - timedelta(seconds=p['monitor_interval_seconds']):
                            continue
                        store.set_meta(connection, key, now.isoformat())
                    actions.fetch_performance(action['id'])
                    with store.transaction() as connection:
                        decision = actions.evaluate_lifecycle(connection, action['id'])
                    child = decision.get('action')
                    if child and child['status'] == 'approved' and not p['kill_switch']:
                        actions.execute(child['id'])
            except DomainError as error:
                errors.append(error.code)
        state = {'status': 'completed' if not errors else 'partial', 'at': store.now(), 'checked_factors': completed, 'errors': errors[:30]}
        with store.transaction() as connection:
            store.set_meta(connection, 'growth_worker_status', state)
        return state
    finally:
        with store.transaction() as connection:
            lease = store.meta(connection, 'growth_worker_lease') or {}
            if lease.get('owner') == owner:
                store.set_meta(connection, 'growth_worker_lease', {})


async def run_worker(stop: asyncio.Event):
    while not stop.is_set():
        try:
            await asyncio.to_thread(tick)
        except Exception:
            # Keep failures visible without persisting credentials or private responses.
            with store.transaction() as connection:
                store.set_meta(connection, 'growth_worker_status', {'status': 'error', 'at': store.now(), 'errors': ['WORKER_FAILED']})
        try:
            await asyncio.wait_for(stop.wait(), timeout=15)
        except TimeoutError:
            pass
