import {
  integer,
  pgTable,
  varchar,
  timestamp,
  unique,
  text,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const shopItemsTable = pgTable("shop_items", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar().notNull(),
  image: varchar().notNull(),
  description: varchar().notNull(),
  price: integer().notNull(),
  category: varchar().notNull(),
  count: integer().notNull().default(0),
  baseProbability: integer("base_probability").notNull().default(50),
  baseUpgradeCost: integer("base_upgrade_cost").notNull().default(10),
  costMultiplier: integer("cost_multiplier").notNull().default(115),
  boostAmount: integer("boost_amount").notNull().default(1),
  rollCostOverride: integer("roll_cost_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const shopHeartsTable = pgTable(
  "shop_hearts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    shopItemId: integer("shop_item_id")
      .notNull()
      .references(() => shopItemsTable.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.shopItemId)],
);

export const shopOrdersTable = pgTable("shop_orders", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  shopItemId: integer("shop_item_id")
    .notNull()
    .references(() => shopItemsTable.id),
  quantity: integer().notNull().default(1),
  pricePerItem: integer("price_per_item").notNull(),
  totalPrice: integer("total_price").notNull(),
  status: varchar().notNull().default("pending"),
  orderType: varchar("order_type").notNull().default("purchase"),
  shippingAddress: text("shipping_address"),
  phone: varchar(),
  notes: text(),
  isFulfilled: boolean("is_fulfilled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const shopRollsTable = pgTable("shop_rolls", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  shopItemId: integer("shop_item_id")
    .notNull()
    .references(() => shopItemsTable.id),
  rolled: integer().notNull(),
  threshold: integer().notNull(),
  won: boolean().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const refineryOrdersTable = pgTable("refinery_orders", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  shopItemId: integer("shop_item_id")
    .notNull()
    .references(() => shopItemsTable.id),
  cost: integer().notNull(),
  boostAmount: integer("boost_amount").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shopPenaltiesTable = pgTable(
  "shop_penalties",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    shopItemId: integer("shop_item_id")
      .notNull()
      .references(() => shopItemsTable.id),
    probabilityMultiplier: integer("probability_multiplier")
      .notNull()
      .default(100),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.shopItemId)],
);

export const refinerySpendingHistoryTable = pgTable(
  "refinery_spending_history",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    shopItemId: integer("shop_item_id")
      .notNull()
      .references(() => shopItemsTable.id),
    cost: integer().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);
