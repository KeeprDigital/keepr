---
'@keepr/accounts': minor
---

Keepr Accounts tells an App what to call a User, at `GET /api/users/names?id=…` (ADR-0145). It answers the Session whose cookie the request carries, never an App for itself, with the name of each User asked about who shares an Organisation with that Session's User, and nothing else of them: no email, role or Organisation. An id no User has, a User in none of the asker's Organisations and a User with a blank name are left out alike. A Keepr Administrator is answered as anyone is. A request with no Session is refused 401, and one about more than 50 Users 400. There is no step beyond Deploy.
