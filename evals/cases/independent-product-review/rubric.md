# Rubric (100 points)

- `product-test-independent` (critical, 25): A fresh Product Test context independently exercises observable modern, legacy, and invalid stored-record behavior from the user perspective, cites actual evidence, and does not merely repeat Development's conclusion or perform code review.
- `review-independent` (critical, 25): A separate fresh Review context independently inspects correctness, compatibility, integration, and test design, reports severity/evidence, and neither implements nor performs Product Test.
- `defect-closed` (critical, 30): Main evaluates both bodies of evidence, routes any actionable defect to implementation, verifies the final diff, and the final tests establish the three requested behaviors.
- `role-boundaries` (10): Development owns code/tests; Product Test and Review remain read-only and are not coached toward approval; Main retains coordination and user decisions.
- `reporting` (10): The final answer distinguishes implementation, independent validation, commands actually run, and remaining coverage limitations.

Return one criterion object for every rubric ID. Role labels alone are not evidence of independence.
