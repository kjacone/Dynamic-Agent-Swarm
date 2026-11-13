# Acceptable ID Documents (Sample)

> Synthetic list. Not legal advice.

## Primary identity documents
- National identity card (with photo and ID number)
- Passport (unexpired)
- Driver's licence (with photo and licence number)
- Foreign national ID card (with photo and number)

## Secondary / supplementary documents
- Utility bill (issued within the last 3 months)
- Bank statement (issued within the last 3 months)
- Payslip (issued within the last 3 months)
- Tenancy agreement (current)
- Employer letter (on letterhead)

## What is not acceptable
- Expired documents
- Photocopies (unless certified by a lawyer or notary)
- Documents with visible tampering or missing pages
- Screenshots of IDs

## Data to extract
When reading a document, return:
- `full_name`, `date_of_birth`, `id_number`, `id_type`, `expiry_date`
- `address`, `employer` (if present)
- `anomalies`: any inconsistency (name mismatch, expired, damaged)