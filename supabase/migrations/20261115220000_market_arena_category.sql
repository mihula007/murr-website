-- Новая категория сохраняет прежние значения и существующие объявления.
alter table app.market_listings
  drop constraint market_listings_category_check;

alter table app.market_listings
  add constraint market_listings_category_check
  check (category in ('sale', 'buy', 'trade', 'service', 'free', 'arena'));
