# Core Data Structures

Choosing the right data structure determines algorithm efficiency. Each structure trades memory for speed in different ways.

## Hash tables

Hash tables map keys to values using a hash function. Average-case lookup, insert, and delete are O(1). Collisions are resolved by chaining or open addressing. Hash maps underpin caches, sets, and index lookups.

## Trees

Binary search trees keep elements sorted for O(log n) search. Self-balancing variants like AVL and red-black trees maintain this bound after insertions. B-trees store many keys per node and are used in database indexes and file systems.

## Graphs

Graphs model relationships between entities as nodes and edges. Breadth-first search finds shortest paths in unweighted graphs. Depth-first search detects cycles and computes topological order.

## Heaps

A binary heap supports O(log n) insert and O(1) min/max access. Priority queues, Dijkstra's algorithm, and heap sort all rely on this property.

## Arrays vs linked lists

Arrays provide O(1) random access but costly insertion. Linked lists support O(1) prepend but require O(n) traversal for index access.
