# Web Security Basics

Web applications are exposed to a wide range of attacks. Understanding common vulnerabilities is the first step toward building secure systems.

## Injection attacks

**SQL injection** inserts malicious SQL into user-supplied input. Use parameterized queries or prepared statements — never interpolate user input into SQL strings.

**Command injection** passes unsanitized input to shell commands. Avoid calling system shells with user data; use safe APIs instead.

## Cross-site scripting (XSS)

XSS injects malicious scripts into pages viewed by other users. Reflected XSS embeds the payload in a URL. Stored XSS persists it in the database. Mitigate with output encoding and a strict Content Security Policy.

## Cross-site request forgery (CSRF)

CSRF tricks a logged-in user's browser into sending an unwanted request to another site. Defend with CSRF tokens or the `SameSite` cookie attribute.

## Authentication and sessions

Store passwords as salted hashes (bcrypt, Argon2). Use short-lived session tokens and rotate them after login. Enforce HTTPS to prevent session token interception.

## Security headers

```
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

## Dependency vulnerabilities

Third-party packages are a common attack vector. Regularly audit dependencies with tools like `npm audit`, `pip-audit`, or Dependabot, and update promptly when CVEs are disclosed.
