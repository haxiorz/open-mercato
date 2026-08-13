import { Migration } from '@mikro-orm/migrations';

export class Migration20260810165323_catalog extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "catalog_products" add "lifecycle_state" text not null default 'active';`);
    this.addSql(`create index "catalog_products_lifecycle_scope_idx" on "catalog_products" ("organization_id", "tenant_id", "lifecycle_state");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_lifecycle_state_check" check ("lifecycle_state" in ('draft', 'active', 'archived'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "catalog_products_lifecycle_scope_idx";`);
    this.addSql(`alter table "catalog_products" drop constraint if exists "catalog_products_lifecycle_state_check";`);
    this.addSql(`alter table "catalog_products" drop column "lifecycle_state";`);
  }

}
