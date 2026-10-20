-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('SELF', 'DEPT', 'ALL');

-- CreateEnum
CREATE TYPE "EnableStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "InquiryDocStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED', 'EVALUATED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('INVITED', 'SUBMITTED', 'DECLINED', 'EVALUATING', 'WON', 'LOST', 'VOID');

-- CreateEnum
CREATE TYPE "QuoteVersionSource" AS ENUM ('ONLINE', 'EXCEL', 'NEGOTIATION');

-- CreateEnum
CREATE TYPE "NegotiationStatus" AS ENUM ('OPEN', 'AGREED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NegotiationParty" AS ENUM ('BUYER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "NegotiationMsgType" AS ENUM ('OFFER', 'COUNTER', 'ACCEPT', 'REJECT', 'CLOSE');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('INVITATION', 'REMINDER', 'OPENING', 'NEGOTIATION', 'AWARD', 'RESULT', 'CHANGE', 'APPROVAL', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "FileAccessAction" AS ENUM ('PREVIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "PointsSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "userType" "UserType" NOT NULL DEFAULT 'INTERNAL',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "departmentCode" TEXT,
    "supplierId" TEXT,
    "lastLoginAt" TIMESTAMPTZ(3),
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "forSupplier" BOOLEAN NOT NULL DEFAULT false,
    "dataScope" "DataScope" NOT NULL DEFAULT 'SELF',
    "permissions" TEXT[],
    "fieldPermissions" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictType" (
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DictType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "DictItem" (
    "id" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "EnableStatus" NOT NULL DEFAULT 'ENABLED',
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DictItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemParam" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemParam_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" "UserType",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAccessLog" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierId" TEXT,
    "inquiryId" TEXT,
    "action" "FileAccessAction" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialCategory" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "pplVariantCode" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "EnableStatus" NOT NULL DEFAULT 'ENABLED',
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MaterialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "spec" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brand" TEXT,
    "imageFileId" TEXT,
    "status" "EnableStatus" NOT NULL DEFAULT 'ENABLED',
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "creditCode" TEXT,
    "categoryCode" TEXT NOT NULL,
    "country" TEXT,
    "address" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "ccEmails" TEXT[],
    "preferredLanguage" TEXT NOT NULL DEFAULT 'zh-CN',
    "status" "EnableStatus" NOT NULL DEFAULT 'ENABLED',
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMaterialCategory" (
    "supplierId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "SupplierMaterialCategory_pkey" PRIMARY KEY ("supplierId","categoryId")
);

-- CreateTable
CREATE TABLE "SupplierPointsEntry" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "source" "PointsSource" NOT NULL,
    "inquiryId" TEXT,
    "roundId" TEXT,
    "remark" TEXT,
    "bizKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPointsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PplTemplateSet" (
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PplTemplateSet_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "draftNo" TEXT NOT NULL,
    "formalNo" TEXT,
    "projectNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "description" TEXT,
    "docStatus" "InquiryDocStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRoundNo" INTEGER NOT NULL DEFAULT 1,
    "currentRoundStatus" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "currentDeadline" TIMESTAMPTZ(3),
    "ownerId" TEXT NOT NULL,
    "pdUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "departmentCode" TEXT,
    "lastRejectComment" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryApproval" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryInvitee" (
    "inquiryId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryInvitee_pkey" PRIMARY KEY ("inquiryId","supplierId")
);

-- CreateTable
CREATE TABLE "InquiryRound" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMPTZ(3),
    "changeReason" TEXT,
    "changeSummary" TEXT,
    "pplTemplateVersion" INTEGER,
    "pplVariantCode" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" TEXT,
    "quotesClosedAt" TIMESTAMPTZ(3),
    "closedEarly" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMPTZ(3),
    "openedById" TEXT,
    "evaluatedAt" TIMESTAMPTZ(3),
    "awardedById" TEXT,
    "awardComment" TEXT,
    "autoReminderSentAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InquiryRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryLine" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "materialId" TEXT,
    "categoryId" TEXT NOT NULL,
    "materialCode" TEXT,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "spec" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "brand" TEXT,
    "drawingRef" TEXT,
    "remark" TEXT,
    "sourceLineId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InquiryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryFile" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "lineId" TEXT,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstViewedAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "lastSubmittedAt" TIMESTAMPTZ(3),
    "declineReasonCode" TEXT,
    "declineReason" TEXT,
    "declinedAt" TIMESTAMPTZ(3),
    "currentVersionId" TEXT,
    "draftValues" JSONB,
    "draftUpdatedAt" TIMESTAMPTZ(3),
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "shortlistedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersion" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "source" "QuoteVersionSource" NOT NULL,
    "values" JSONB NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "remark" TEXT,
    "changeNote" TEXT,
    "templateVersion" INTEGER NOT NULL,
    "variantCode" TEXT NOT NULL,
    "negotiationMessageId" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Negotiation" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "NegotiationStatus" NOT NULL DEFAULT 'OPEN',
    "agreedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Negotiation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationMessage" (
    "id" TEXT NOT NULL,
    "negotiationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "party" "NegotiationParty" NOT NULL,
    "type" "NegotiationMsgType" NOT NULL,
    "lines" JSONB,
    "content" TEXT,
    "replyToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "deliveryDate" DATE,
    "deliveryPlace" TEXT,
    "paymentTerms" TEXT,
    "summary" TEXT,
    "remark" TEXT,
    "snapshot" JSONB NOT NULL,
    "signedScanFileId" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractApproval" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "type" "EmailType" NOT NULL,
    "language" TEXT NOT NULL,
    "toAddresses" TEXT[],
    "ccAddresses" TEXT[],
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "supplierId" TEXT,
    "userId" TEXT,
    "inquiryId" TEXT,
    "bizKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_supplierId_idx" ON "User"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserToken_userId_idx" ON "UserToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DictItem_typeCode_code_key" ON "DictItem"("typeCode", "code");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileAccessLog_inquiryId_createdAt_idx" ON "FileAccessLog"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "FileAccessLog_fileId_idx" ON "FileAccessLog"("fileId");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Attachment_fileId_idx" ON "Attachment"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCategory_code_key" ON "MaterialCategory"("code");

-- CreateIndex
CREATE INDEX "MaterialCategory_parentId_idx" ON "MaterialCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Material_categoryId_idx" ON "Material"("categoryId");

-- CreateIndex
CREATE INDEX "Material_status_idx" ON "Material"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_creditCode_key" ON "Supplier"("creditCode");

-- CreateIndex
CREATE INDEX "Supplier_categoryCode_idx" ON "Supplier"("categoryCode");

-- CreateIndex
CREATE INDEX "SupplierMaterialCategory_categoryId_idx" ON "SupplierMaterialCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPointsEntry_bizKey_key" ON "SupplierPointsEntry"("bizKey");

-- CreateIndex
CREATE INDEX "SupplierPointsEntry_supplierId_createdAt_idx" ON "SupplierPointsEntry"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_draftNo_key" ON "Inquiry"("draftNo");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_formalNo_key" ON "Inquiry"("formalNo");

-- CreateIndex
CREATE INDEX "Inquiry_projectNo_idx" ON "Inquiry"("projectNo");

-- CreateIndex
CREATE INDEX "Inquiry_docStatus_currentRoundStatus_idx" ON "Inquiry"("docStatus", "currentRoundStatus");

-- CreateIndex
CREATE INDEX "Inquiry_ownerId_idx" ON "Inquiry"("ownerId");

-- CreateIndex
CREATE INDEX "InquiryApproval_inquiryId_idx" ON "InquiryApproval"("inquiryId");

-- CreateIndex
CREATE INDEX "InquiryInvitee_supplierId_idx" ON "InquiryInvitee"("supplierId");

-- CreateIndex
CREATE INDEX "InquiryRound_status_deadline_idx" ON "InquiryRound"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "InquiryRound_inquiryId_roundNo_key" ON "InquiryRound"("inquiryId", "roundNo");

-- CreateIndex
CREATE UNIQUE INDEX "InquiryLine_roundId_lineNo_key" ON "InquiryLine"("roundId", "lineNo");

-- CreateIndex
CREATE INDEX "InquiryFile_roundId_idx" ON "InquiryFile"("roundId");

-- CreateIndex
CREATE INDEX "InquiryFile_lineId_idx" ON "InquiryFile"("lineId");

-- CreateIndex
CREATE INDEX "InquiryFile_fileId_idx" ON "InquiryFile"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_currentVersionId_key" ON "Quote"("currentVersionId");

-- CreateIndex
CREATE INDEX "Quote_supplierId_status_idx" ON "Quote"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_roundId_supplierId_key" ON "Quote"("roundId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_negotiationMessageId_key" ON "QuoteVersion"("negotiationMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_quoteId_versionNo_key" ON "QuoteVersion"("quoteId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Negotiation_quoteId_key" ON "Negotiation"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "NegotiationMessage_negotiationId_seq_key" ON "NegotiationMessage"("negotiationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNo_key" ON "Contract"("contractNo");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_inquiryId_key" ON "Contract"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_quoteId_key" ON "Contract"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_quoteVersionId_key" ON "Contract"("quoteVersionId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_supplierId_idx" ON "Contract"("supplierId");

-- CreateIndex
CREATE INDEX "ContractApproval_contractId_idx" ON "ContractApproval"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_bizKey_key" ON "EmailMessage"("bizKey");

-- CreateIndex
CREATE INDEX "EmailMessage_status_nextAttemptAt_idx" ON "EmailMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailMessage_type_createdAt_idx" ON "EmailMessage"("type", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_supplierId_idx" ON "EmailMessage"("supplierId");

-- CreateIndex
CREATE INDEX "EmailMessage_inquiryId_idx" ON "EmailMessage"("inquiryId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DictItem" ADD CONSTRAINT "DictItem_typeCode_fkey" FOREIGN KEY ("typeCode") REFERENCES "DictType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAccessLog" ADD CONSTRAINT "FileAccessLog_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCategory" ADD CONSTRAINT "MaterialCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_imageFileId_fkey" FOREIGN KEY ("imageFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMaterialCategory" ADD CONSTRAINT "SupplierMaterialCategory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMaterialCategory" ADD CONSTRAINT "SupplierMaterialCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPointsEntry" ADD CONSTRAINT "SupplierPointsEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_pdUserId_fkey" FOREIGN KEY ("pdUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryApproval" ADD CONSTRAINT "InquiryApproval_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryApproval" ADD CONSTRAINT "InquiryApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryInvitee" ADD CONSTRAINT "InquiryInvitee_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryInvitee" ADD CONSTRAINT "InquiryInvitee_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryRound" ADD CONSTRAINT "InquiryRound_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryLine" ADD CONSTRAINT "InquiryLine_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "InquiryRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryLine" ADD CONSTRAINT "InquiryLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryLine" ADD CONSTRAINT "InquiryLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryFile" ADD CONSTRAINT "InquiryFile_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "InquiryRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryFile" ADD CONSTRAINT "InquiryFile_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "InquiryLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryFile" ADD CONSTRAINT "InquiryFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "InquiryRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_negotiationMessageId_fkey" FOREIGN KEY ("negotiationMessageId") REFERENCES "NegotiationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Negotiation" ADD CONSTRAINT "Negotiation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationMessage" ADD CONSTRAINT "NegotiationMessage_negotiationId_fkey" FOREIGN KEY ("negotiationId") REFERENCES "Negotiation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationMessage" ADD CONSTRAINT "NegotiationMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractApproval" ADD CONSTRAINT "ContractApproval_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractApproval" ADD CONSTRAINT "ContractApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
