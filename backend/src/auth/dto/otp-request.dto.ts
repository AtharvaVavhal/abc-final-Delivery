import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OtpRequestDto {
  /** Indian mobile number in any common format; normalised server-side. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;
}
