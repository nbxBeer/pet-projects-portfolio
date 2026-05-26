# SQL Databases

Relational databases store data in tables with rows and columns. SQL (Structured Query Language) is the standard interface for querying and manipulating relational data.

## Core SQL

```sql
SELECT name, score FROM notes WHERE score > 0.5 ORDER BY score DESC LIMIT 10;
INSERT INTO notes (title, text) VALUES ('My note', 'Content here');
UPDATE notes SET text = 'Updated' WHERE id = 42;
DELETE FROM notes WHERE created_at < '2020-01-01';
```

## Joins

Joins combine rows from two or more tables on a matching condition. INNER JOIN returns only matched rows. LEFT JOIN returns all rows from the left table with nulls for unmatched right rows.

## Indexes

Indexes speed up queries by building a sorted structure on one or more columns. A B-tree index enables fast range queries. A hash index suits exact equality lookups. Over-indexing slows writes and wastes space.

## Transactions and ACID

A transaction groups multiple statements into an atomic unit. ACID guarantees: Atomicity (all or nothing), Consistency (constraints are preserved), Isolation (concurrent transactions don't interfere), Durability (committed data survives crashes).

## Query planning

The query planner chooses how to execute a query. `EXPLAIN ANALYZE` shows the execution plan and actual timing, revealing full-table scans and missing indexes.
