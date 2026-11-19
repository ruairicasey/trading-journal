-- HIP-3 pair labels: "SPX/USD · xyz" -> "SPX/USD (xyz)" (exchange-owned label only; idempotent)
UPDATE `trades` SET `display_pair` = substr(`display_pair`, 1, instr(`display_pair`, ' · ') - 1) || ' (' || substr(`display_pair`, instr(`display_pair`, ' · ') + 3) || ')' WHERE `market_type` = 'hip3' AND `display_pair` LIKE '% · %';
