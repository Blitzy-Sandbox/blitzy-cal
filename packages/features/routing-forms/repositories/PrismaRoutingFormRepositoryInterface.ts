// Dedicated type definition for routing form data
export type RoutingForm = {
  id: string;
  description: string | null;
  position: number;
  routes: any; // JSON field
  createdAt: Date;
  updatedAt: Date;
  name: string;
  fields: any; // JSON field
  updatedById: number | null;
  userId: number | null;
  teamId: number | null;
  disabled: boolean;
  settings: any; // JSON field
};

// Helper type for select parameter
export type RoutingFormSelect = {
  [K in keyof RoutingForm]?: boolean;
};

// Helper type for selected fields
export type SelectedFields<T> = T extends undefined
  ? RoutingForm
  : {
      [K in keyof T as T[K] extends true ? K : never]: K extends keyof RoutingForm ? RoutingForm[K] : never;
    };

// Type for findById options
export type FindByIdOptions<T extends RoutingFormSelect | undefined = undefined> = {
  select?: T;
};

/** Input data for creating a new routing form via API v2 */
export type RoutingFormCreateData = {
  /** Form display name — required */
  name: string;
  /** Owner user ID — required */
  userId: number;
  /** Optional form description */
  description?: string | null;
  /** Optional JSON field definitions */
  fields?: any; // JSON field — matches Prisma schema type
  /** Optional JSON route definitions */
  routes?: any; // JSON field — matches Prisma schema type
  /** Optional JSON settings */
  settings?: any; // JSON field — matches Prisma schema type
  /** Optional team ID for team-scoped forms */
  teamId?: number | null;
  /** Whether form is disabled — defaults to false */
  disabled?: boolean;
  /** Display position — defaults to 0 */
  position?: number;
};

/** Input data for updating an existing routing form via API v2 */
export type RoutingFormUpdateData = {
  /** Updated form name */
  name?: string;
  /** Updated form description */
  description?: string | null;
  /** Updated JSON field definitions */
  fields?: any; // JSON field
  /** Updated JSON route definitions */
  routes?: any; // JSON field
  /** Updated JSON settings */
  settings?: any; // JSON field
  /** Updated disabled state */
  disabled?: boolean;
  /** Updated display position */
  position?: number;
};

/** Routing form with full route definitions — returned by findByIdWithRoutes */
export type RoutingFormWithRoutes = RoutingForm;

/** Routing form with response count aggregation — returned by findFormWithResponseCount */
export type RoutingFormWithResponseCount = RoutingForm & {
  _count: {
    responses: number;
  };
};

// Type for findFormByIdIncludeUserTeamAndOrg result
export type RoutingFormWithUserTeamAndOrg = {
  id: string;
  description: string | null;
  position: number;
  routes: any;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  fields: any;
  updatedById: number | null;
  userId: number;
  teamId: number | null;
  disabled: boolean;
  settings: any;
  user: {
    id: number;
    metadata: any;
    organization: {
      slug: string | null;
    } | null;
    username: string | null;
    email: string;
    movedToProfileId: number | null;
    timeFormat: number | null;
    locale: string | null;
  };
  team: {
    metadata: any;
    slug: string | null;
    parentId: number | null;
    parent: {
      slug: string | null;
    } | null;
  } | null;
};

// Interface for static methods (for documentation and type checking purposes)
export interface IPrismaRoutingFormRepositoryStatic {
  findById<T extends RoutingFormSelect | undefined = undefined>(
    id: string,
    options?: FindByIdOptions<T>
  ): Promise<SelectedFields<T> | null>;

  findFormByIdIncludeUserTeamAndOrg(formId: string): Promise<RoutingFormWithUserTeamAndOrg | null>;

  // New API v2 parity methods (RF-004)

  /** Retrieve all routing forms belonging to a specific team */
  findAllByTeamId(teamId: number): Promise<RoutingForm[]>;

  /** Retrieve a routing form by ID with full route definitions */
  findByIdWithRoutes(id: string): Promise<RoutingFormWithRoutes | null>;

  /** Update an existing routing form with partial data */
  updateForm(id: string, data: RoutingFormUpdateData): Promise<RoutingForm>;

  /** Create a new routing form */
  createForm(data: RoutingFormCreateData): Promise<RoutingForm>;

  /** Soft-delete a routing form by disabling it — returns id and disabled state */
  deleteForm(id: string): Promise<{ id: string; disabled: boolean }>;

  /** Retrieve a routing form with its response count aggregation */
  findFormWithResponseCount(id: string): Promise<RoutingFormWithResponseCount | null>;
}
