Use pnpm for dependency changes. Do not commit or push unless requested. Never add co-authors or marketing to commit messages. Preserve unrelated edits.

Keep server routes in modules, shared DTOs in packages/contracts, and database schema/migrations in packages/db. Better Auth owns authentication; never reimplement password or cookie handling. Authorize protected API access on the server.

TanStack Query owns remote data. Zustand owns non-sensitive UI preferences only. Put navigable state in TanStack Router URLs. Keep theme tokens and UI primitives separate from feature behavior so visual references can be applied without replacing auth or data plumbing.

Read installed Turborepo docs before changing its configuration. Run pnpm verify; use TEST_DATABASE_URL for database integration tests.
