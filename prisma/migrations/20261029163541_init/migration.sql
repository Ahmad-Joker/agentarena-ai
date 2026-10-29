-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('DEMO', 'LIVE');

-- CreateEnum
CREATE TYPE "AgentProvider" AS ENUM ('SIMULATED', 'HARNESSROUTER');

-- CreateEnum
CREATE TYPE "TaskLanguage" AS ENUM ('TYPESCRIPT', 'JAVASCRIPT', 'PYTHON');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('ALGORITHM', 'BUG_FIX', 'PARSING', 'STRING_PROCESSING', 'VALIDATION', 'DATA_TRANSFORMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BenchmarkStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "BenchmarkProfile" AS ENUM ('BALANCED', 'CORRECTNESS', 'SPEED', 'COST');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('PROVIDER_REPORTED', 'SIMULATED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'COMPLETED', 'PARTIAL', 'ERROR');

-- CreateEnum
CREATE TYPE "ArtifactSource" AS ENUM ('PROVIDER_FILE', 'EXTRACTED_FROM_OUTPUT', 'SIMULATED_FIXTURE');

-- CreateEnum
CREATE TYPE "RoutingConfidence" AS ENUM ('INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfiguration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "provider" "AgentProvider" NOT NULL,
    "mode" "ExecutionMode" NOT NULL,
    "harnessId" TEXT,
    "base" TEXT,
    "model" TEXT,
    "languages" "TaskLanguage"[],
    "runtimeNotes" JSONB,
    "color" TEXT NOT NULL DEFAULT '#8b5cf6',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodingTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "language" "TaskLanguage" NOT NULL,
    "category" "TaskCategory" NOT NULL,
    "starterFiles" JSONB NOT NULL,
    "entryFile" TEXT NOT NULL,
    "entryFunction" TEXT NOT NULL,
    "expectedBehavior" TEXT NOT NULL,
    "testSpec" JSONB,
    "constraints" JSONB,
    "contentHash" TEXT NOT NULL,
    "isFixture" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "mode" "ExecutionMode" NOT NULL,
    "status" "BenchmarkStatus" NOT NULL DEFAULT 'PENDING',
    "profile" "BenchmarkProfile" NOT NULL DEFAULT 'BALANCED',
    "weights" JSONB NOT NULL,
    "timeoutSeconds" INTEGER NOT NULL,
    "maxConcurrency" INTEGER NOT NULL,
    "maxCostUsd" DOUBLE PRECISION,
    "promptSnapshot" TEXT NOT NULL,
    "winnerRunId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "benchmarkId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "externalResponseId" TEXT,
    "externalSessionId" TEXT,
    "configSnapshot" JSONB NOT NULL,
    "finalOutput" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "usage" JSONB,
    "costUsd" DOUBLE PRECISION,
    "costSource" "CostSource" NOT NULL DEFAULT 'UNAVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'text/plain',
    "source" "ArtifactSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "correctness" DOUBLE PRECISION,
    "reliability" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "efficiency" DOUBLE PRECISION,
    "security" DOUBLE PRECISION,
    "totalScore" DOUBLE PRECISION,
    "coverage" DOUBLE PRECISION NOT NULL,
    "testsPassed" INTEGER NOT NULL DEFAULT 0,
    "testsFailed" INTEGER NOT NULL DEFAULT 0,
    "testsSkipped" INTEGER NOT NULL DEFAULT 0,
    "runtimeAvailable" BOOLEAN NOT NULL,
    "weights" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRecommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mode" "ExecutionMode" NOT NULL,
    "query" TEXT NOT NULL,
    "language" "TaskLanguage",
    "category" "TaskCategory",
    "objective" "BenchmarkProfile" NOT NULL,
    "recommendedAgentId" TEXT,
    "alternativeAgentId" TEXT,
    "confidence" "RoutingConfidence" NOT NULL,
    "explanation" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfiguration" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfiguration_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AgentConfiguration_workspaceId_mode_isActive_idx" ON "AgentConfiguration"("workspaceId", "mode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfiguration_workspaceId_name_key" ON "AgentConfiguration"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "CodingTask_workspaceId_language_category_idx" ON "CodingTask"("workspaceId", "language", "category");

-- CreateIndex
CREATE INDEX "Benchmark_workspaceId_mode_createdAt_idx" ON "Benchmark"("workspaceId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "Benchmark_status_idx" ON "Benchmark"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_idempotencyKey_key" ON "AgentRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_status_idx" ON "AgentRun"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_benchmarkId_agentId_key" ON "AgentRun"("benchmarkId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionEvent_runId_sequence_key" ON "ExecutionEvent"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_runId_path_key" ON "Artifact"("runId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationResult_runId_key" ON "EvaluationResult"("runId");

-- CreateIndex
CREATE INDEX "RoutingRecommendation_workspaceId_createdAt_idx" ON "RoutingRecommendation"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentConfiguration" ADD CONSTRAINT "AgentConfiguration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingTask" ADD CONSTRAINT "CodingTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CodingTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "Benchmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvent" ADD CONSTRAINT "ExecutionEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRecommendation" ADD CONSTRAINT "RoutingRecommendation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRecommendation" ADD CONSTRAINT "RoutingRecommendation_recommendedAgentId_fkey" FOREIGN KEY ("recommendedAgentId") REFERENCES "AgentConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRecommendation" ADD CONSTRAINT "RoutingRecommendation_alternativeAgentId_fkey" FOREIGN KEY ("alternativeAgentId") REFERENCES "AgentConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
