# Functional Programming

Functional programming treats computation as the evaluation of mathematical functions. Programs are built by composing pure functions that avoid shared state and mutable data.

## Pure functions

A pure function always returns the same output for the same input and produces no side effects. Pure functions are easy to test, cache, and reason about in isolation.

## Immutability

Immutable data structures cannot be modified after creation. Instead of mutating, operations return new values. This eliminates an entire class of bugs caused by aliasing and shared mutable state.

## Higher-order functions

Functions are first-class values. `map`, `filter`, and `reduce` transform collections without explicit loops:

```js
const scores = notes.map(n => score(n)).filter(s => s > 0.5);
const total  = scores.reduce((sum, s) => sum + s, 0);
```

## Closures

A closure captures variables from its surrounding scope. This enables partial application and the module pattern without classes.

## Monads and composition

Monads (Option, Result, Promise) model computations that may fail or be asynchronous. They allow chaining operations with `flatMap` while keeping error handling explicit and composable.

## Languages

Haskell enforces purity by the type system. Scala, Clojure, and Elixir encourage functional style. JavaScript, Python, and Kotlin support functional patterns alongside imperative code.
