import { ApiProperty } from '@nestjs/swagger';

/** The uniform error body produced by DomainErrorFilter: `{ code, message }`. */
export class ErrorResponseDto {
  @ApiProperty({ example: 'INVALID_STATE', description: 'Stable DomainErrorCode (see docs/API.md §7).' })
  code!: string;

  @ApiProperty({ example: 'A customer with externalRef "ext-1" and an overlapping role already exists' })
  message!: string;
}
