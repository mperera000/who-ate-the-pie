/* @bruin

name: analytics.accusations
type: duckdb.sql
description: "Which bear does Goldilocks accuse most, and how often is she right?"

materialization:
  type: table

depends:
  - raw.decisions

columns:
  - name: suspect
    type: string
    description: "The accused bear"
    checks:
      - name: not_null
      - name: accepted_values
        value: ["papa", "mama", "baby"]
  - name: times_accused
    type: integer
    checks:
      - name: positive

@bruin */

WITH films AS (
  SELECT DISTINCT run_id, accused, culprits
  FROM raw.decisions
  WHERE accused IS NOT NULL AND accused <> ''
)
SELECT
  accused AS suspect,
  COUNT(*) AS times_accused,
  SUM(CASE WHEN list_contains(string_split(culprits, '|'), accused) THEN 1 ELSE 0 END) AS times_right
FROM films
GROUP BY 1
ORDER BY times_accused DESC
