# Memory Management

Programs need memory to store data. How memory is allocated, used, and freed determines performance and correctness.

## Stack vs heap

The **stack** holds function call frames and local variables. It grows and shrinks automatically as functions are called and return. Stack allocation is fast but limited in size.

The **heap** stores dynamically allocated objects with longer or unpredictable lifetimes. Heap allocation is more flexible but requires explicit management or garbage collection.

## Manual memory management

In C and C++, the programmer calls `malloc`/`free` or `new`/`delete`. Errors include memory leaks (forgetting to free), dangling pointers (using freed memory), and double frees. Tools like Valgrind and AddressSanitizer detect these bugs.

## Garbage collection

Garbage collectors automatically reclaim memory that is no longer reachable. Tracing GC (used in Java, Python, Go) scans the heap for live objects. Reference counting (used in Swift, CPython) tracks how many pointers point to each object.

GC pauses can be a concern for latency-sensitive applications. Generational collectors (G1, ZGC) reduce pause times by collecting short-lived objects more frequently.

## Ownership and borrowing

Rust's ownership system enforces memory safety at compile time. Each value has one owner. Borrowing rules prevent data races and dangling references without a garbage collector.
