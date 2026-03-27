import "./instrument";

import {
  API_VERSIONS,
  API_VERSIONS_ENUM,
  CAL_API_VERSION_HEADER,
  VERSION_2024_04_15,
  X_CAL_CLIENT_ID,
  X_CAL_PLATFORM_EMBED,
  X_CAL_SECRET_KEY,
} from "@calcom/platform-constants";
import type { ValidationError } from "@nestjs/common";
import { BadRequestException, Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { Request } from "express";
import helmet from "helmet";
import { CalendarServiceExceptionFilter } from "./filters/calendar-service-exception.filter";
import { TRPCExceptionFilter } from "./filters/trpc-exception.filter";
import { HttpExceptionFilter } from "@/filters/http-exception.filter";
import { PrismaExceptionFilter } from "@/filters/prisma-exception.filter";
import { ZodExceptionFilter } from "@/filters/zod-exception.filter";

const logger: Logger = new Logger("Bootstrap");

export const bootstrap = (app: NestExpressApplication): NestExpressApplication => {
  try {
    if (!process.env.VERCEL) {
      app.enableShutdownHooks();
    }
    app.enableVersioning({
      type: VersioningType.CUSTOM,
      extractor: (request: unknown) => {
        const headerVersion = (request as Request)?.headers[CAL_API_VERSION_HEADER] as string | undefined;
        if (headerVersion && API_VERSIONS.includes(headerVersion as API_VERSIONS_ENUM)) {
          return headerVersion;
        }
        return VERSION_2024_04_15;
      },
      defaultVersion: VERSION_2024_04_15,
    });
    app.use(helmet());
    // CORS configuration: use environment-specified allowed origins in production,
    // fall back to wildcard only in development mode for local testing convenience.
    // Set ALLOWED_ORIGINS as a comma-separated list of origins (e.g., "https://app.cal.com,https://cal.com").
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : undefined;
    const corsOrigin =
      allowedOrigins && allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV === "production"
          ? false
          : "*";

    app.enableCors({
      origin: corsOrigin,
      methods: ["GET", "PATCH", "DELETE", "HEAD", "POST", "PUT", "OPTIONS"],
      allowedHeaders: [
        X_CAL_CLIENT_ID,
        X_CAL_SECRET_KEY,
        X_CAL_PLATFORM_EMBED,
        CAL_API_VERSION_HEADER,
        "Accept",
        "Authorization",
        "Content-Type",
        "Origin",
      ],
      maxAge: 86_400,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        validationError: {
          target: true,
          value: true,
        },
        exceptionFactory(errors: ValidationError[]): BadRequestException {
          return new BadRequestException({ errors });
        },
      })
    );
    // Exception filters, new filters go at the bottom, keep the order
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.useGlobalFilters(new ZodExceptionFilter());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalFilters(new TRPCExceptionFilter());
    app.useGlobalFilters(new CalendarServiceExceptionFilter());
    app.use(cookieParser());

    if (process?.env?.API_GLOBAL_PREFIX) {
      app.setGlobalPrefix(process?.env?.API_GLOBAL_PREFIX);
    }

    return app;
  } catch (error) {
    logger.error("Error starting NestJS app:", error);
    throw error;
  }
};
