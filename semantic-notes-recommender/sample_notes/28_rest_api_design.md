# REST API Design

REST (Representational State Transfer) is an architectural style for building web APIs over HTTP. Resources are addressed by URLs and manipulated with standard HTTP methods.

## HTTP methods

- `GET` — retrieve a resource, must be safe and idempotent
- `POST` — create a new resource or trigger an action
- `PUT` — replace a resource entirely
- `PATCH` — partially update a resource
- `DELETE` — remove a resource

## Status codes

- `200 OK`, `201 Created`, `204 No Content` — success
- `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found` — client errors
- `500 Internal Server Error`, `503 Service Unavailable` — server errors

## Versioning

APIs should be versioned to allow breaking changes without breaking existing clients. Common strategies include URL path versioning (`/v1/users`) and header-based versioning.

## Pagination and filtering

Large collections should support cursor-based or offset pagination. Filtering and sorting parameters keep responses focused and reduce payload size.

## Hypermedia (HATEOAS)

Mature REST APIs include links in responses that guide clients to related actions, reducing coupling between client and server.
