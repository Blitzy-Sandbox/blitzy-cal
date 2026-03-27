import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsNumber, IsOptional, IsString, Min, Max } from "class-validator";

import { SkipTakePagination, SortOrder, SortOrderType } from "../../../pagination/pagination.input";

export class GetEventTypesQuery_2024_06_14 {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description:
      "The username of the user to get event types for. If only username provided will get all event types.",
  })
  username?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      "Slug of event type to return. Notably, if eventSlug is provided then username must be provided too, because multiple users can have event with same slug.",
  })
  eventSlug?: string;

  @IsOptional()
  @TransformUsernames()
  @ApiPropertyOptional({
    description:
      "Get dynamic event type for multiple usernames separated by comma. e.g `usernames=alice,bob`",
    type: String,
  })
  usernames?: string[];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description:
      "slug of the user's organization if he is in one, orgId is not required if using this parameter",
    type: String,
  })
  orgSlug?: string;

  @Transform(({ value }) => Number(value))
  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({
    description:
      "ID of the organization of the user you want the get the event-types of, orgSlug is not needed when using this parameter",
    type: Number,
  })
  orgId?: number;

  @ApiPropertyOptional({
    enum: SortOrder,
    description: "Sort event types by creation date. When not provided, no explicit ordering is applied.",
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortCreatedAt?: SortOrderType;
}

export class GetTeamEventTypesQuery_2024_06_14 {
  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: "Slug of team event type to return.",
  })
  eventSlug?: string;

  @Transform(({ value }) => Number(value))
  @IsOptional()
  @IsNumber()
  @Min(1, { message: "hostsLimit must be at least 1" })
  @Max(1000, { message: "hostsLimit must not exceed 1000" })
  @ApiPropertyOptional({
    description:
      "Specifies the maximum number of hosts to include in the response (1–1000). This limit helps optimize performance. If not provided, all Hosts will be fetched.",
  })
  hostsLimit?: number;

  @ApiPropertyOptional({
    enum: SortOrder,
    description: "Sort event types by creation date. When not provided, no explicit ordering is applied.",
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortCreatedAt?: SortOrderType;
}

export class GetOrganizationEventTypesQuery_2024_06_14 extends SkipTakePagination {
  @ApiPropertyOptional({
    enum: SortOrder,
    description: "Sort event types by creation date. When not provided, no explicit ordering is applied.",
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortCreatedAt?: SortOrderType;
}

function TransformUsernames() {
  return Transform(({ value }) => {
    if (typeof value === "string") {
      return value.split(",").map((username) => username.trim());
    }
    return value;
  });
}
