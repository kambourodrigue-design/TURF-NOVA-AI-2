UPDATE shop_daily SET expenses = COALESCE((
  SELECT SUM(COALESCE(json_extract(r.json,'$.amount'),0))
  FROM records r
  WHERE r.shop_id = shop_daily.shop_id AND r.kind = 'expenses' AND r.deleted = 0
    AND substr(json_extract(r.json,'$.date'),1,10) = shop_daily.day
    AND COALESCE(json_extract(r.json,'$.category'),'') NOT IN ('supply','personal_draw')
), 0);

UPDATE shop_stats SET expenses_total = COALESCE((
  SELECT SUM(d.expenses) FROM shop_daily d WHERE d.shop_id = shop_stats.shop_id
), 0);
