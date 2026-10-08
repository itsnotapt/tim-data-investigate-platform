# Security

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting:

1. Open the repository's [Security tab](https://github.com/itsnotapt/tim-data-investigate-platform/security).
2. Select **Report a vulnerability** ([direct link](https://github.com/itsnotapt/tim-data-investigate-platform/security/advisories/new)).
3. Fill in the advisory form.

Only the maintainers can see the report. We discuss it with you in the draft advisory and publish it once a fix is released.

Include as much of the following as you can:

- The type of issue (for example SQL injection, cross-site scripting, token leakage) and its impact.
- The affected component (`web`, `api` or the Helm chart) and release version, or the commit.
- The file paths or source locations involved.
- Any configuration needed to reproduce it.
- Step-by-step instructions to reproduce it, and proof-of-concept code if you have it.

## Supported versions

Security fixes are made on the latest release only. `web`, `api` and the Helm chart share one release version.
