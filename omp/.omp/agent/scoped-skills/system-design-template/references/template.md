# System Design Template

This is the output template. Fill every section. Use "TBD" for unknowns.

---

```markdown
# System Design — [Project Name]

## 1. Services

Document every external or internal service the DE interacts with.

| Question | Service #1 | Service #2 |
|---|---|---|
| What is the service? | | |
| What purpose does the service have? | | |
| How do we handle authentication? (OAuth, API key, service account, etc.) | | |
| Read, Write, or Both? | | |
| Rate limits or quotas? | | |
| Other Notes | | |

---

## 2. Workflows

### 2.1 Workflow: [Name]

**Purpose:** [1–2 sentence description of the workflow and its end outcome.]

**Trigger:** [What initiates this workflow — schedule, event, manual, etc.]

#### Steps

| Step | Description | Services Used |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |

#### Error Handling

| Failure Point | Behavior | Retry? |
|---|---|---|
| | | |

#### KPIs & Metrics

| Metric | Description | Target / Threshold |
|---|---|---|
| | | |

#### Queues

How will queues be used in this workflow?

---

## 3. Dependencies & Risks

| Dependency / Risk | Impact | Mitigation |
|---|---|---|
| | | |

---

## 4. Testing

### 4.1 Testing Strategy

**Local Testing**
1. [Describe local setup and how to run the workflow locally.]

**Unit Testing**
1. [Key units to test and what they validate.]

**Integration Testing**
1. [Happy and unhappy path tests with services mocked.]

### 4.2 PDA Wrapping

List every operation that must be wrapped in `performDangerousAction`:

- [e.g., Updating client CRM records]
- [e.g., Sending emails to clients]

### 4.3 Promotion Criteria

Define what is required to move between deployment phases:

- **Passive → Active Beta:** [Criteria, metrics thresholds, observation window.]
- **Active Beta → Stable Release:** [Criteria, metrics thresholds, observation window.]
```
