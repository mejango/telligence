if (!process.env.TEST_DATABASE_URL) {
  process.stderr.write("TEST_DATABASE_URL is required for the database integration gate. Use an isolated test database.\n");
  process.exitCode = 1;
} else {
  let valid = false;
  try {
    const url = new URL(process.env.TEST_DATABASE_URL);
    valid = ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.pathname.slice(1));
  } catch {
    // An invalid URL exception can contain the input, including credentials.
  }
  if (!valid) {
    process.stderr.write("TEST_DATABASE_URL must identify a PostgreSQL test database.\n");
    process.exitCode = 1;
  }
}
