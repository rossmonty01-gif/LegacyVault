# Contributing

Thank you for improving LegacyVault.

## Local workflow

1. Create a feature branch.
2. Copy `.env.example` to `.env`.
3. Run the app locally and test the changed flows.
4. Keep changes focused and include README updates when setup or behavior changes.

## Security-sensitive changes

LegacyVault handles estate, financial and personal data. Treat authentication, file upload, permissions, audit logs and calculator outputs as security-sensitive areas.

Before merging production-facing changes, review:

- Access control checks
- Session handling
- File upload validation
- Audit logging coverage
- Legal and tax disclaimers
- Data retention and backup implications

## Reporting vulnerabilities

Do not open a public issue for a suspected vulnerability. Contact the repository owner privately with reproduction steps and impact.