# Distributed Systems

A distributed system coordinates multiple nodes over a network to work as a single system. Nodes communicate by passing messages and may fail independently.

## Key concepts

- **Consistency**: all nodes see the same data at the same time
- **Availability**: every request receives a response
- **Partition tolerance**: the system continues operating when network splits occur

The CAP theorem states that a distributed system can guarantee at most two of these three properties simultaneously.

## Consensus algorithms

Raft and Paxos are widely used consensus protocols. They elect a leader node that coordinates writes, ensuring that a majority of nodes agree before committing any change.

## Replication strategies

- **Leader-follower**: one node accepts writes and propagates to replicas
- **Multi-leader**: multiple nodes accept writes, requiring conflict resolution
- **Leaderless**: any node can accept writes; quorum reads and writes ensure consistency

Distributed databases like Cassandra, CockroachDB, and etcd each make different tradeoffs between these properties.
