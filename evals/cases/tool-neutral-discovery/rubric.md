# Rubric (100 points)

- `tool-neutral` (critical, 30): The candidate does not stop or claim discovery is impossible when `rg` fails; it uses a different available search, navigation, or file-inspection capability.
- `repository-discovery` (critical, 30): Evidence shows it follows the entry export to `src/lib/slug.js` and inspects relevant tests rather than limiting work to the named entry file.
- `verified-fix` (critical, 30): The implementation handles punctuation, repeated separators, surrounding separators, and lowercase output while retaining the public export; executable tests pass.
- `reporting` (10): The final response reports the actual alternative discovery and validation evidence without prescribing one mandatory tool for future work.

Return one criterion object for every rubric ID. Judge capability and outcome, not use of a particular fallback command.
