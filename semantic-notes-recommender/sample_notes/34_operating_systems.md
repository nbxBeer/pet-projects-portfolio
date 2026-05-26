# Operating Systems

An operating system manages hardware resources and provides abstractions that applications rely on: processes, memory, file systems, and I/O.

## Processes and threads

A **process** is an isolated running program with its own address space. A **thread** shares an address space with other threads in the same process, enabling cheaper context switches and shared memory communication.

Context switching saves the current thread's registers and loads another thread's state. The scheduler decides which thread runs next.

## Scheduling

- **Round-robin**: each thread runs for a fixed time slice before being preempted
- **Priority scheduling**: higher-priority threads preempt lower-priority ones
- **CFS (Completely Fair Scheduler)**: Linux scheduler that aims to give each thread a fair share of CPU time

## Virtual memory

The OS maps each process's virtual addresses to physical RAM through page tables. Pages not in RAM are swapped to disk (paging). Translation Lookaside Buffers (TLBs) cache recent address translations.

## Synchronization

Mutual exclusion (mutex) prevents concurrent access to shared data. Semaphores generalize mutexes for resource counting. Deadlock occurs when two threads each wait for a lock held by the other.

## System calls

Applications request OS services through system calls: `read`, `write`, `fork`, `exec`, `mmap`. The CPU switches from user mode to kernel mode on each call.
