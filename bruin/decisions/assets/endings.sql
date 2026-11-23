/* @bruin

name: analytics.endings
type: duckdb.sql
description: "Same setup, different endings: how often each ending happens."

materialization:
  type: table

depends:
  - raw.decisions

columns:
  - name: ending
    type: string
    checks:
      - name: not_null

@bruin */

SELECT ending, COUNT(DISTINCT run_id) AS films
FROM raw.decisions
WHERE ending IS NOT NULL AND ending <> ''
GROUP BY 1
ORDER BY films DESC
