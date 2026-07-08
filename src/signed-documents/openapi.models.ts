/**
 * OpenAPI documentation models for the signed-document endpoints (admin + integration).
 * Documentation only — runtime shapes live in the service/DTO.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SignedDocumentUploadBodyModel {
  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'The signed PDF (multipart field `file`).' })
  file?: unknown;

  @ApiPropertyOptional({ description: 'Fallback: PDF file name (only with the base64 `file` fallback).' })
  fileName?: string;

  @ApiProperty({ example: 'signed-offer', description: 'DocumentTypeDef key — MUST be an external type.' })
  documentTypeKey!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-06-15T00:00:00Z', description: 'Signature date (backdatable).' })
  signedAt!: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  signerName?: string;

  @ApiPropertyOptional({ example: 'HubSpot deal 12345 / signed offer' })
  reference?: string;

  @ApiPropertyOptional({ example: 'customer', description: 'Audience key (validated to exist when given).' })
  audience?: string;

  @ApiPropertyOptional({ example: 'Counter-signed on 2026-06-15.' })
  note?: string;
}

export class SignedDocumentModel {
  @ApiProperty({ example: 'sd-8a71…' })
  id!: string;

  @ApiProperty({ example: 'c-123' })
  customerId!: string;

  @ApiProperty({ example: 'signed-offer' })
  documentTypeKey!: string;

  @ApiPropertyOptional({ example: 'customer' })
  audience?: string;

  @ApiProperty({ example: 'signed-offer.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'sha256:…', description: 'SHA-256 over the PDF, computed host-side.' })
  contentHash!: string;

  @ApiProperty({ example: 20480 })
  fileSize!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  signedAt!: Date;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  signerName?: string;

  @ApiPropertyOptional({ example: 'HubSpot deal 12345 / signed offer' })
  reference?: string;

  @ApiPropertyOptional()
  note?: string;

  @ApiProperty({ example: 'u-42', description: 'Actor who uploaded the document.' })
  uploadedBy!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  uploadedAt!: Date;

  @ApiProperty({ description: 'Time-limited (presigned) download URL of the signed PDF.' })
  pdfUrl!: string;
}

export class SignedDocumentListResponseModel {
  @ApiProperty({ type: [SignedDocumentModel] })
  items!: SignedDocumentModel[];
}
