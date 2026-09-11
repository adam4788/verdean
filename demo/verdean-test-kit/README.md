# Verdean Test Kit source

This directory is the versioned source for the prepared Desktop demo kit.

Run from the repository root:

```bash
npm run demo:prepare
```

The command safely recreates `${VERDEAN_TEST_KIT_DIR:-$HOME/Desktop/Verdean Test Kit}` with:

- the current five canonical quote, email, invoice, transcript, and contract fixtures;
- the self-contained HTML test guide;
- the self-contained Verdean how-it-works document and its assets;
- executable launch, reset, and verification commands;
- isolated optional recovery fixtures.

The generator removes only known generated output and optional drop-ins inside the prepared kit. Do not connect this repository template directory to Verdean; connect the generated Desktop folder so `_Verdean` output never dirties the checkout.
