




export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["health_api_v1_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["mcp_config_api_v1_mcp_config_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspace/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;

        post: operations["demo_api_v1_workspace_session_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;

        post: operations["logout_api_v1_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/console": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["console_api_v1_console_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/commands/{command}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;

        post: operations["command_api_v1_commands__command__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crm-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["crm_tasks_api_v1_crm_tasks_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["events_api_v1_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["mcp_skills_api_v1_mcp_skills_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/skills/{skill_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["mcp_skill_api_v1_mcp_skills__skill_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["mcp_summary_api_v1_mcp_summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/skills/{skill_id}/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;

        post: operations["mcp_run_api_v1_mcp_skills__skill_id__run_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mcp/skills/{skill_id}/tools/{tool}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;

        post: operations["mcp_tool_api_v1_mcp_skills__skill_id__tools__tool__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sources/{source_id}/rows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["source_data_rows_api_v1_sources__source_id__rows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/customers/{customer_id}/business": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };

        get: operations["customer_business_detail_api_v1_customers__customer_id__business_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {

        Action: {

            id: string;

            customer: string;

            title: string;

            status: string;

            external_id: string;

            idempotency_key: string;

            verified_at: string;

            due_at: string;

            plan_id: string;

            owner: string;
        };

        Agent: {

            id: string;

            name: string;

            description: string;

            status: string;

            version: string;

            tools: string[];

            runs: number;
        };

        Arguments: {

            arguments?: {
                [key: string]: unknown;
            };
        };

        ConsoleData: {

            mode: string;

            as_of: string;

            revision: number;

            incidents: components["schemas"]["Incident"][];

            runs: components["schemas"]["Run"][];

            plans: components["schemas"]["Plan"][];

            actions: components["schemas"]["Action"][];

            sources: components["schemas"]["Source"][];

            agents: components["schemas"]["Agent"][];

            skills: components["schemas"]["Skill"][];

            trend: {
                [key: string]: unknown;
            }[];

            coverage: {
                [key: string]: number;
            };

            experiments: {
                [key: string]: unknown;
            }[];

            memories: {
                [key: string]: unknown;
            }[];

            settings: {
                [key: string]: unknown;
            };

            audit: {
                [key: string]: unknown;
            }[];
        };

        ConsoleEnvelope: {
            data: components["schemas"]["ConsoleData"];
        };

        HTTPValidationError: {

            detail?: components["schemas"]["ValidationError"][];
        };

        Incident: {

            id: string;

            customer: string;

            segment: string;

            title: string;

            kind: string;

            priority: number;

            status: string;

            hours: number;

            value: number;

            consent: boolean | null;

            support: boolean;

            coverage: boolean;

            owner: string;

            facts: string[];

            run_id: string | null;
        };

        Plan: {

            id: string;

            incident_id: string;

            run_id: string;

            customer: string;

            title: string;

            purpose: string;

            owner: string;

            status: string;

            version: number;

            hash: string;

            budget: number;

            expires_at: string;

            reason: string;

            checks: string[];
        };

        Run: {

            id: string;

            incident_id: string;

            customer: string;

            title: string;

            state: string;

            started_at: string;

            model_calls: number;

            tool_calls: number;

            events: components["schemas"]["RunEvent"][];
        };

        RunEvent: {

            id: string;

            node: string;

            title: string;

            detail: string;

            at: string;

            status: string;

            tool?: string | null;
        };

        Skill: {

            id: string;

            name: string;

            description: string;

            version: string;

            status: string;

            instructions: string;

            input_schema: string;

            tools: string[];

            updated_at: string;
        };

        Source: {

            id: string;

            role: string;

            name: string;

            rows: number;

            status: string;

            coverage: boolean;

            as_of: string;

            columns?: string[] | null;

            preview?: {
                [key: string]: string;
            }[] | null;

            mapping?: {
                [key: string]: string;
            } | null;
        };

        ValidationError: {

            loc: (string | number)[];

            msg: string;

            type: string;

            input?: unknown;

            ctx?: Record<string, never>;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_v1_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    mcp_config_api_v1_mcp_config_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    demo_api_v1_workspace_session_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    logout_api_v1_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    console_api_v1_console_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleEnvelope"];
                };
            };
        };
    };
    command_api_v1_commands__command__post: {
        parameters: {
            query?: never;
            header?: {
                "idempotency-key"?: string | null;
            };
            path: {
                command: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    crm_tasks_api_v1_crm_tasks_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    events_api_v1_events_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    mcp_skills_api_v1_mcp_skills_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mcp_skill_api_v1_mcp_skills__skill_id__get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                skill_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mcp_summary_api_v1_mcp_summary_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mcp_run_api_v1_mcp_skills__skill_id__run_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                skill_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Arguments"];
            };
        };
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    mcp_tool_api_v1_mcp_skills__skill_id__tools__tool__post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                skill_id: string;
                tool: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Arguments"];
            };
        };
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    source_data_rows_api_v1_sources__source_id__rows_get: {
        parameters: {
            query?: {
                offset?: number;
                limit?: number;
            };
            header?: never;
            path: {
                source_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    customer_business_detail_api_v1_customers__customer_id__business_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                customer_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {

            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };

            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
