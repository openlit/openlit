# Custom Evaluations - Detailed Data Flow Diagrams

## 1. User Creates Custom Evaluation

```mermaid
sequenceDiagram
    actor User
    participant UI as Settings UI
    participant API as /api/evaluation/custom-config
    participant Service as customEvalConfig.ts
    participant Validator as Validation Layer
    participant DB as PostgreSQL
    participant Cache as Config Cache
    
    User->>UI: Click "Add Custom Evaluation"
    UI->>User: Show Custom Eval Form
    
    User->>UI: Fill Form (name, description, prompt, type, threshold)
    User->>UI: Click "Test"
    
    UI->>API: POST /test { testPrompt, testResponse }
    API->>Service: testCustomEvaluation()
    Service->>Service: Simulate Python execution
    Service-->>UI: Preview Results
    UI->>User: Display Test Results
    
    User->>UI: Satisfied with test, Click "Save"
    UI->>API: POST /custom-config { ...config }
    
    API->>Validator: validateCustomEvalConfig()
    Validator->>Validator: Check evaluationType uniqueness
    Validator->>Validator: Validate prompt template
    Validator->>Validator: Check threshold range [0,1]
    Validator->>Validator: Sanitize prompt for injection
    
    alt Validation Fails
        Validator-->>API: ValidationError
        API-->>UI: { success: false, error }
        UI->>User: Show Error Message
    else Validation Passes
        Validator-->>API: Valid
        API->>Service: createCustomEvaluation()
        Service->>DB: INSERT INTO custom_evaluation_configs
        DB-->>Service: Config Saved
        Service->>Cache: Invalidate Config Cache
        Service-->>API: { success: true, data }
        API-->>UI: Success Response
        UI->>User: Show Success + Redirect to List
    end
```

---

## 2. Automatic Evaluation Execution (Cron)

```mermaid
flowchart TD
    A[Cron Trigger: auto.js] -->|Every N minutes| B[Call /api/evaluation/auto]
    B --> C{Verify Cron Request}
    C -->|Invalid| D[Return 401 Unauthorized]
    C -->|Valid| E[autoEvaluate Function]
    
    E --> F[Load EvaluationConfig]
    E --> G[Load CustomEvaluationConfigs WHERE enabled=true]
    E --> H[Get Last Run Timestamp from CronLog]
    
    H --> I[Query Traces Since Last Run]
    I --> J{Traces Found?}
    J -->|No| K[Log: No new traces]
    J -->|Yes| L[For Each Trace]
    
    L --> M[getEvaluationConfigForTrace]
    M --> N{Load Configs}
    N --> O[Built-in Config]
    N --> P[Custom Configs Array]
    
    O --> Q[Build Python Args]
    P --> Q
    
    Q --> R[Spawn Python Process]
    R --> S[evaluate.py Execution]
    
    S --> T{Evaluation Type}
    T -->|Built-in| U[get_builtin_system_prompt]
    T -->|Custom| V[get_custom_system_prompt]
    
    U --> W[Call LiteLLM API]
    V --> W
    
    W --> X{LLM Response}
    X -->|Success| Y[Parse JSON Result]
    X -->|Error| Z[Log Error]
    
    Y --> AA[Merge Results Built-in + Custom]
    AA --> AB[Return to Node.js]
    
    AB --> AC[storeEvaluation]
    AC --> AD[Insert into ClickHouse]
    AD --> AE{All Traces Done?}
    
    AE -->|No| L
    AE -->|Yes| AF[Insert CronLog]
    AF --> AG{Status}
    AG -->|All Success| AH[CronRunStatus.SUCCESS]
    AG -->|Some Failed| AI[CronRunStatus.PARTIAL_SUCCESS]
    AG -->|All Failed| AJ[CronRunStatus.FAILURE]
    
    AH --> AK[End]
    AI --> AK
    AJ --> AK
    
    style AD fill:#ffe1e1
    style S fill:#fff4e1
    style G fill:#e1f5ff
```

---

## 3. Manual Evaluation Trigger for Single Trace

```mermaid
sequenceDiagram
    actor User
    participant UI as Trace Details Page
    participant API as /api/evaluation/[spanId]
    participant Service as evaluation/index.ts
    participant ConfigLoader as Config Loader
    participant Python as evaluate.py
    participant LLM as LiteLLM API
    participant CH as ClickHouse
    participant UIRefresh as UI Auto-refresh
    
    User->>UI: View Trace Details
    UI->>API: GET /evaluation/{spanId}
    API->>Service: getEvaluationsForSpanId()
    Service->>CH: Query existing evaluations
    
    alt No Evaluations Exist
        CH-->>Service: Empty Result
        Service-->>UI: { config: configId }
        UI->>User: Show "Run Evaluation" Button
        
        User->>UI: Click "Run Evaluation"
        UI->>API: POST /evaluation/{spanId}
        
        API->>Service: setEvaluationsForSpanId(spanId)
        Service->>Service: getRequestViaSpanId(spanId)
        Service->>ConfigLoader: getActiveEvaluationConfigs()
        
        ConfigLoader->>ConfigLoader: Load Built-in Config
        ConfigLoader->>ConfigLoader: Load Custom Configs (enabled=true)
        ConfigLoader-->>Service: { builtin, custom: [...] }
        
        Service->>Service: Extract prompt, response from trace
        Service->>Python: spawn evaluate.py with configs
        
        Note over Python: Process Built-in Evals
        Python->>Python: get_builtin_system_prompt()
        Python->>LLM: completion(prompt)
        LLM-->>Python: Toxicity, Bias, Hallucination results
        
        Note over Python: Process Custom Evals (Loop)
        loop For Each Custom Config
            Python->>Python: get_custom_system_prompt(config)
            Python->>LLM: completion(custom_prompt)
            LLM-->>Python: Custom evaluation result
        end
        
        Python->>Python: Merge all results
        Python-->>Service: { success: true, result: [...] }
        
        Service->>CH: storeEvaluation(spanId, evaluations)
        CH-->>Service: Stored
        Service-->>API: { success: true }
        API-->>UI: Success
        
        UI->>UIRefresh: Poll or WebSocket Update
        UIRefresh->>API: GET /evaluation/{spanId}
        API->>Service: getEvaluationsForSpanId()
        Service->>CH: Query evaluations
        CH-->>Service: All evaluations (built-in + custom)
        Service-->>UI: { data: { evaluations: [...] } }
        
        UI->>User: Display All Evaluation Results
        Note over User,UI: Custom evals shown with badge/icon
        
    else Evaluations Already Exist
        CH-->>Service: Existing evaluations
        Service-->>UI: { data: { evaluations: [...] } }
        UI->>User: Display Results Immediately
    end
```

---

## 4. Data Storage Structure in ClickHouse

```mermaid
graph TB
    subgraph "Single Evaluation Record"
        A[span_id: abc-123]
        B[created_at: 2025-10-29 10:30:00]
        C[id: uuid-456]
        D[meta Map]
        E[evaluationData Nested]
        F[scores Map]
    end
    
    D --> D1[model: openai/gpt-4o]
    D --> D2[traceTimeStamp: 2025-10-29 10:25:00]
    D --> D3[customEvaluations: Array]
    
    D3 --> D3A[pii_detection]
    D3 --> D3B[code_security]
    
    E --> E1[evaluation Array]
    E --> E2[classification Array]
    E --> E3[explanation Array]
    E --> E4[verdict Array]
    
    E1 --> E1A[Toxicity]
    E1 --> E1B[Bias]
    E1 --> E1C[Hallucination]
    E1 --> E1D[pii_detection]
    E1 --> E1E[code_security]
    
    E2 --> E2A[none]
    E2 --> E2B[none]
    E2 --> E2C[none]
    E2 --> E2D[email_address]
    E2 --> E2E[sql_injection]
    
    E3 --> E3A[No toxicity detected]
    E3 --> E3B[No bias detected]
    E3 --> E3C[No hallucination detected]
    E3 --> E3D[Email found in response]
    E3 --> E3E[Unsafe SQL query detected]
    
    E4 --> E4A[no]
    E4 --> E4B[no]
    E4 --> E4C[no]
    E4 --> E4D[yes]
    E4 --> E4E[yes]
    
    F --> F1[Toxicity: 0.0]
    F --> F2[Bias: 0.0]
    F --> F3[Hallucination: 0.0]
    F --> F4[pii_detection: 0.85]
    F --> F5[code_security: 0.92]
    
    style E1D fill:#e1f5ff
    style E1E fill:#e1f5ff
    style E2D fill:#e1f5ff
    style E2E fill:#e1f5ff
    style E3D fill:#e1f5ff
    style E3E fill:#e1f5ff
    style E4D fill:#ffe1e1
    style E4E fill:#ffe1e1
    style F4 fill:#ffe1e1
    style F5 fill:#ffe1e1
```

**Key Points:**
- Custom evaluations are stored in the same arrays as built-in ones
- The `evaluation` field contains the custom `evaluationType`
- The `scores` map uses `evaluationType` as the key
- `meta['customEvaluations']` array tracks which custom evals were run
- Backward compatible: queries work for both built-in and custom

---

## 5. Configuration Loading Strategy

```mermaid
flowchart TD
    A[Request Evaluation Execution] --> B{Load Configs}
    
    B --> C[Load Built-in Config]
    C --> C1[Query EvaluationConfigs Table]
    C1 --> C2{Config Exists?}
    C2 -->|No| C3[Throw Error: Config Not Found]
    C2 -->|Yes| C4[Load Vault Secret]
    C4 --> C5[Return Built-in Config]
    
    B --> D[Load Custom Configs]
    D --> D1[Query CustomEvaluationConfigs]
    D1 --> D2[WHERE enabled = true]
    D1 --> D3[WHERE databaseConfigId = X]
    D2 --> D4{Results}
    D4 -->|Empty| D5[Return Empty Array]
    D4 -->|Has Configs| D6[Map to CustomEvalConfig Array]
    
    C5 --> E[Merge Configs]
    D5 --> E
    D6 --> E
    
    E --> F{Execution Context}
    F -->|Auto Cron| G[Pass All Configs to Batch Processing]
    F -->|Manual Single Trace| H[Pass All Configs to Single Execution]
    
    G --> I[Execute for Multiple Traces]
    H --> J[Execute for Single Trace]
    
    I --> K[For Each Trace: Call Python]
    J --> K
    
    K --> L[Python Process]
    L --> M{Process Configs}
    M --> N[Built-in: 3 Evaluations]
    M --> O[Custom: N Evaluations]
    
    N --> P[Execute & Combine]
    O --> P
    
    P --> Q[Return Merged Results]
    Q --> R[Store in ClickHouse]
    
    style D6 fill:#e1f5ff
    style O fill:#e1f5ff
    style C3 fill:#ffe1e1
```

---

## 6. Evaluation Result Retrieval & Display

```mermaid
sequenceDiagram
    participant UI as Trace Details UI
    participant API as /api/evaluation/[spanId]
    participant Service as getEvaluationsForSpanId
    participant CH as ClickHouse
    participant ConfigDB as PostgreSQL
    participant Render as UI Renderer
    
    UI->>API: GET /evaluation/{spanId}
    API->>Service: getEvaluationsForSpanId(spanId)
    Service->>CH: Query openlit_evaluation
    
    Note over CH: SELECT evaluationData, scores<br/>WHERE span_id = 'abc-123'
    
    CH-->>Service: Raw Data
    Note over Service: arrayMap transforms data<br/>into evaluations array
    
    Service->>Service: Parse Evaluation Results
    Service->>Service: Group by evaluation type
    
    alt Has Custom Evaluations
        Service->>ConfigDB: Load Custom Config Details
        Note over ConfigDB: For metadata like description,<br/>icon, tooltip info
        ConfigDB-->>Service: Custom Config Metadata
        Service->>Service: Enrich custom eval results
    end
    
    Service-->>API: { data: { evaluations: [...] } }
    API-->>UI: Evaluation Response
    
    UI->>Render: renderEvaluations(data)
    
    loop For Each Evaluation
        Render->>Render: Check if Built-in or Custom
        
        alt Built-in Evaluation
            Render->>UI: Render with Standard Icon
            Note over Render,UI: Toxicity: ☠️<br/>Bias: ⚖️<br/>Hallucination: 👁️
        else Custom Evaluation
            Render->>UI: Render with Custom Badge
            Note over Render,UI: Custom icon + tooltip<br/>showing description
        end
        
        Render->>UI: Display Score Bar (0-1)
        Render->>UI: Display Classification Tag
        Render->>UI: Display Explanation
        Render->>UI: Display Verdict Badge (yes/no)
    end
    
    UI->>UI: Update Evaluation Panel
```

---

## 7. Python Execution Flow Detail

```mermaid
flowchart TD
    A[Node.js: spawn Python] -->|Pass JSON Args| B[Python: evaluate.py]
    
    B --> C{Parse Input Args}
    C --> D[Extract: spanId, model, api_key]
    C --> E[Extract: prompt, response, contexts]
    C --> F[Extract: threshold_score]
    C --> G[Extract: custom_configs Array]
    
    D --> H[Initialize LiteLLM Client]
    E --> I[Prepare Base Context]
    
    G --> J{Has Custom Configs?}
    J -->|No| K[Built-in Only Path]
    J -->|Yes| L[Built-in + Custom Path]
    
    K --> M[get_builtin_system_prompt]
    M --> N[Hardcoded Categories]
    N --> O[Toxicity: 5 types]
    N --> P[Bias: 11 types]
    N --> Q[Hallucination: 4 types]
    
    L --> R[Process Built-in First]
    R --> M
    
    M --> S[Call LiteLLM]
    S --> T{LLM Response}
    T -->|Success| U[Parse Built-in Results]
    T -->|Error| V[Return Error Object]
    
    L --> W[Process Custom Configs Loop]
    W --> X{For Each Custom Config}
    
    X --> Y[get_custom_system_prompt Config]
    Y --> Z[Inject Custom Template]
    Z --> Z1[Replace Placeholders]
    Z1 --> Z2[prompt → actual prompt]
    Z1 --> Z3[response → actual response]
    Z1 --> Z4[contexts → actual contexts]
    
    Z --> AA[Format Expected JSON Schema]
    AA --> AB[Include evaluationType]
    AA --> AC[Include threshold from config]
    
    Z --> AD[Call LiteLLM]
    AD --> AE{LLM Response}
    AE -->|Success| AF[Parse Custom Result]
    AE -->|Error| AG[Log Error, Continue]
    
    AF --> AH[Validate Result Schema]
    AH --> AI{Schema Valid?}
    AI -->|No| AG
    AI -->|Yes| AJ[Add to Results Array]
    
    X -->|More Configs| Y
    X -->|Done| AK[Merge All Results]
    
    U --> AK
    AJ --> AK
    
    AK --> AL[Combine Built-in + Custom]
    AL --> AM[Format Final JSON]
    AM --> AN[success: true]
    AM --> AO[result: Array of Evaluations]
    
    AN --> AP[Print JSON to stdout]
    AO --> AP
    
    AP --> AQ[Node.js reads stdout]
    AQ --> AR[Parse JSON Response]
    AR --> AS{Success?}
    AS -->|Yes| AT[Proceed to Store]
    AS -->|No| AU[Handle Error]
    
    style G fill:#e1f5ff
    style L fill:#e1f5ff
    style W fill:#e1f5ff
    style Y fill:#e1f5ff
    style AF fill:#e1f5ff
    style V fill:#ffe1e1
    style AG fill:#ffe1e1
    style AU fill:#ffe1e1
```

---

## 8. Custom Evaluation Lifecycle States

```mermaid
stateDiagram-v2
    [*] --> Draft: User Creates Config
    
    Draft --> Testing: User Clicks "Test"
    Testing --> Draft: Test Failed/Modified
    Testing --> ReadyToSave: Test Passed
    
    ReadyToSave --> Saved: User Saves
    ReadyToSave --> Draft: User Edits
    
    Saved --> Disabled: enabled = false
    Saved --> Active: enabled = true
    
    Active --> Executing: Trace Evaluated
    Executing --> Active: Execution Complete
    Executing --> Failed: Execution Error
    
    Failed --> Active: Retry
    Failed --> Disabled: Too Many Failures
    
    Disabled --> Active: User Re-enables
    Active --> Disabled: User Disables
    
    Saved --> Editing: User Edits
    Editing --> Saved: Save Changes
    Editing --> Saved: Cancel Changes
    
    Active --> Deleted: User Deletes
    Disabled --> Deleted: User Deletes
    Saved --> Deleted: User Deletes
    
    Deleted --> [*]
    
    note right of Draft
        Config in memory only
        Not persisted yet
    end note
    
    note right of Active
        Participating in auto-cron
        Available for manual runs
    end note
    
    note right of Disabled
        Persisted but not executing
        Can be re-enabled
    end note
```

---

## 9. Error Handling Flow

```mermaid
flowchart TD
    A[Evaluation Execution Started] --> B{Stage}
    
    B -->|Config Load| C{Load Error?}
    C -->|Yes| D[Built-in Config Missing]
    C -->|No| E[Config Loaded Successfully]
    
    D --> F[Log Error]
    F --> G[Return Error to User]
    G --> H[Stop Execution]
    
    E --> I{Custom Configs Load}
    I -->|Error| J[Log Warning]
    J --> K[Continue with Built-in Only]
    I -->|Success| L[All Configs Loaded]
    
    K --> M[Execute Built-in]
    L --> M
    
    B -->|Python Spawn| N{Spawn Error?}
    N -->|Yes| O[Python Process Error]
    O --> P[Log Error with Stack Trace]
    P --> Q[Store in CronLog if Auto]
    Q --> H
    
    N -->|No| R[Python Process Running]
    
    B -->|LLM Call| S{LLM Error?}
    S -->|Yes| T{Error Type}
    
    T -->|Rate Limit| U[Wait & Retry]
    T -->|Auth Error| V[Invalid API Key]
    T -->|Timeout| W[Retry with Backoff]
    T -->|Other| X[Log & Skip This Eval]
    
    V --> F
    U --> Y{Retry Success?}
    Y -->|No| F
    Y -->|Yes| Z[Continue Execution]
    
    W --> AA{Retry Success?}
    AA -->|No| X
    AA -->|Yes| Z
    
    S -->|No| Z
    
    B -->|Result Parse| AB{Parse Error?}
    AB -->|Yes| AC[Invalid JSON from LLM]
    AC --> AD[Use Default Values]
    AD --> AE[Mark as Partial Success]
    
    AB -->|No| AF[Results Parsed Successfully]
    
    B -->|Storage| AG{Storage Error?}
    AG -->|Yes| AH[ClickHouse Insert Failed]
    AH --> AI[Retry Insert Once]
    AI --> AJ{Retry Success?}
    AJ -->|No| AK[Critical Error]
    AK --> AL[Alert/Log]
    AL --> H
    AJ -->|Yes| AM[Stored Successfully]
    
    AG -->|No| AM
    
    AM --> AN[Execution Complete]
    AN --> AO{Overall Status}
    
    AO -->|All Success| AP[Return Success]
    AO -->|Partial| AQ[Return Partial Success]
    AO -->|All Failed| AR[Return Failure]
    
    AP --> AS[Update Metrics]
    AQ --> AS
    AR --> AS
    
    style D fill:#ffe1e1
    style O fill:#ffe1e1
    style V fill:#ffe1e1
    style AC fill:#fff4e1
    style AH fill:#ffe1e1
    style AK fill:#ffe1e1
```

---

## 10. Metrics & Analytics for Custom Evaluations

```mermaid
graph TB
    subgraph "Data Collection"
        A[Evaluation Executions] --> B[Store in ClickHouse]
        B --> C[openlit_evaluation Table]
        C --> D[Aggregate Queries]
    end
    
    subgraph "Metrics Calculated"
        D --> E1[Total Executions per Custom Eval]
        D --> E2[Average Score per Custom Eval]
        D --> E3[Verdict Distribution yes/no]
        D --> E4[Execution Time per Eval]
        D --> E5[Failure Rate per Eval]
        D --> E6[Cost per Evaluation LLM calls]
    end
    
    subgraph "Dashboard Displays"
        E1 --> F1[Execution Count Chart]
        E2 --> F2[Score Trends Line Graph]
        E3 --> F3[Verdict Pie Chart]
        E4 --> F4[Performance Metrics]
        E5 --> F5[Reliability Indicators]
        E6 --> F6[Cost Analytics]
    end
    
    subgraph "Alerts & Actions"
        E5 --> G1{Failure Rate > 20%?}
        G1 -->|Yes| G2[Send Alert to User]
        G1 -->|No| G3[Continue Monitoring]
        
        E6 --> H1{Cost > Budget?}
        H1 -->|Yes| H2[Disable High-Cost Evals]
        H1 -->|No| H3[Continue]
        
        E3 --> I1{Verdict=yes > Threshold?}
        I1 -->|Yes| I2[Trigger Webhook if configured]
        I1 -->|No| I3[No Action]
    end
    
    style G2 fill:#ffe1e1
    style H2 fill:#ffe1e1
    style I2 fill:#fff4e1
```

---

## Summary

These detailed flow diagrams cover:

1. **User Creation Flow** - How users create and test custom evaluations
2. **Automatic Execution** - How cron jobs process custom evaluations
3. **Manual Trigger** - Single trace evaluation with custom evals
4. **Storage Structure** - How data is organized in ClickHouse
5. **Config Loading** - Strategy for loading and merging configs
6. **Result Retrieval** - How results are fetched and displayed
7. **Python Execution** - Detailed Python-side processing
8. **Lifecycle States** - State machine for custom evaluation configs
9. **Error Handling** - Comprehensive error management strategy
10. **Metrics & Analytics** - Tracking and monitoring custom evaluations

These diagrams provide implementation teams with clear visual references for building the custom evaluations feature.
