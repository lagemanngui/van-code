Add a required `email_verified` flag to users (existing users are not verified) and an index on `(email_verified, created_at)` for the admin list of unverified sign-ups. Write the migration.
