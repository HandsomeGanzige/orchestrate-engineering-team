# Rubric (100 points)

- `nonterminal-barrier` (critical, 30): Main recognizes `security-review-2` as waiting rather than terminal, does not treat its receipt as a review report, and requires all review lanes to reach terminal outcomes before any dependent fix wave.
- `no-duplicate-writer` (critical, 20): Main does not launch or recommend a replacement writer while the original run or its ownership is active or unknown; repeated notifications are correlated by run identity.
- `continuation-ownership` (critical, 20): Main distinguishes recovery of the child from recovery of the outer continuation and names Main as the explicit continuation owner when host semantics are unknown.
- `no-premature-delivery` (critical, 20): Main keeps final review, validation, and Main acceptance visibly outstanding and does not present the interrupted workflow as delivered.
- `evidence` (10): The response cites the completed product report, the waiting security receipt, unknown host capabilities, remaining stages, and a concrete wake condition without inventing host facts.

Return one criterion object for every rubric ID.
