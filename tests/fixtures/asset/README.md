# Fixture: `asset`

An authored input whose bytes live **outside version control**, represented in the repo
only by a content-addressed stand-in.

## What is here

- `episode.yaml` — declares `narration` at `assets/narration/take-01.wav`
- `assets/narration/take-01.wav.asset` — the committed stand-in
- **`assets/narration/take-01.wav` does not exist, deliberately.** That is the point: the
  bytes are in the store, not in git. A test that "fixes" this by creating the file has
  destroyed what the fixture tests.

## The seed bytes (required to use this fixture)

The stand-in's address is the sha256 of this exact UTF-8 string:

```
fixture narration take-01 bytes
```

- length: **31** bytes
- address: `sha256:4d7c73c9ca17191e076586b31e359bce0b5ed3af81a08be4ea9945c374365308`

A test seeds the store with those bytes to make the asset resolvable:

```ts
const store = new MemoryAssetStore();
const address = await store.put(Buffer.from('fixture narration take-01 bytes', 'utf8'));
// address === the `asset:` field in take-01.wav.asset
```

**This string is recorded because the fixture is useless without it.** The stand-in names a
content address and nothing else; if the bytes it addresses are unknowable, no test can put
them in a store, and the address refers to nothing. A content address whose content cannot
be produced is a fabricated record — which is exactly the failure this system exists to
catch, so a fixture must not contain one.

Regenerate the stand-in from the seed:

```bash
node -e "const{createHash}=require('node:crypto');const b=Buffer.from('fixture narration take-01 bytes','utf8');console.log('sha256:'+createHash('sha256').update(b).digest('hex'), b.length)"
```

## What it exercises

- `pc status` reports the input without contacting the store — the stand-in already carries
  the address, so nothing needs fetching (spec FR-025).
- Store absence surfaces only at an operation that genuinely needs the bytes (spec
  FR-036), never at status.
- Content addressing: identical bytes are a no-op, altered bytes are a different address
  (spec FR-024, FR-028).
