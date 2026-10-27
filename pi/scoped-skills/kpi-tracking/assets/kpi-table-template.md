# KPI table

| KPI name     | When it is sent (human words) | Unit + value sent each report            |
| ------------ | ----------------------------- | ---------------------------------------- |
| `<kpi_name>` | `<trigger description>`       | `<unit>, value_int = <value expression>` |

## Notes

- Keep names consistent with emitted code.
- Describe timing from user/system perspective, not code internals.
- Use concrete units (`ms`, `tasks`, `appointments`, `messages`, `emails`, etc.).
- Remember to also include an extra table indicating what workflows you would include in the Hono app, if they don't exist already in this project
