# Example data

## `spawn-bags.csv`

Three rows for testing CSV batch printing. Verified against the app's own
`parseCsv` / `autoBind` / `resolveVariables`, not just eyeballed.

| strain | lot | date | qr |
|---|---|---|---|
| Blue Oyster | SB-0412 | 2026-11-17 | SB-0412 |
| Pink Oyster, wild | SB-0413 | 2026-11-17 | SB-0413 |
| Lion's Mane (Hericium erinaceus) | SB-0414 | 2026-11-18 | SB-0414 |

Each row is there for a reason:

1. **Short and plain.** The baseline — if this one doesn't print, nothing else matters.
2. **A comma inside a quoted field.** The value is `Pink Oyster, wild`, one field, not two.
   If the label comes out saying `Pink Oyster` or the row splits into five columns, CSV
   quoting is broken.
3. **Long, with an apostrophe and brackets.** 32 characters onto a 40 mm label. This is the
   one that should trip the preflight `outside-label` check, or wrap, or shrink — whatever
   the template is set to do. Worth printing precisely because it is awkward.

### What the template needs

The batch dialog binds CSV columns to the variables the **template** declares, so a
template with no variables will import this file and print three identical labels.

Declare these four in the template's variable list:

| variable | type | required |
|---|---|---|
| `strain` | text | yes |
| `lot` | text | yes |
| `date` | text | no |
| `qr` | text | no |

Then put `{strain}`, `{lot}` and `{date}` in text objects and `{qr}` in a QR or barcode
object. Names match the column headers exactly, so **Auto-bind** maps all four in one
click:

```
{"strain":"strain","lot":"lot","date":"date","qr":"qr"}
```

Binding is saved with the template (`template.variables.csv_mapping`), so the next import
of the same shape needs no clicking at all.

Renaming a column still works — the binder also matches case-insensitively and strips a
`_suffix`, so `lot_code` finds `lot` and `strain_name` finds `strain`.

### A note on serial numbers

If the template has a serial sequence, the serial variable is driven by the sequence, not
by the CSV. A column of that name is ignored. That is deliberate: the server owns serial
allocation so two people batch-printing at once cannot be handed the same number.

### Label size

Written for a 40 × 20 mm label — the roll in the lab. The B1 and the B21 have the
same 48 mm head and feed a label the same way round, so the geometry is the same
for both; only the protocol they speak differs, and the app follows that. On a
D11 (12 mm head) four fields will not fit; drop to `lot` and `qr`.
