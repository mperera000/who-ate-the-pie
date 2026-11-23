/* @bruin

name: analytics.lies
type: duckdb.sql
description: "How often each bear lies when questioned, across all films."

materialization:
  type: table

depends:
  - raw.decisions

columns:
  - name: suspect
    type: string
    checks:
      - name: not_null

@bruin */

SELECT
  actor AS suspect,
  SUM(COALESCE(TRY_CAST(is_lie AS INTEGER), 0)) AS lies,
  COUNT(*) FILTER (WHERE kind IN ('say', 'respond')) AS answers,
  ROUND(100.0 * SUM(COALESCE(TRY_CAST(is_lie AS INTEGER), 0)) / NULLIF(COUNT(*) FILTER (WHERE kind IN ('say', 'respond')), 0), 1) AS lie_rate_pct
FROM raw.decisions
WHERE actor IN ('papa', 'mama', 'baby')
GROUP BY 1
ORDER BY lies DESC
