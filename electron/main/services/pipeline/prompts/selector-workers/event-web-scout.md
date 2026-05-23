# Event web scout

Find up to 3 prediction-market or event-contract candidates with mispriced implied probability.

Prioritize contracts with clear resolution dates, liquid order books, and fresh news flow. Only include symbols backed by current web evidence (instrumentClass `prediction_market`). When finished, call the `submit_result` tool with your candidates; its schema defines every field.
