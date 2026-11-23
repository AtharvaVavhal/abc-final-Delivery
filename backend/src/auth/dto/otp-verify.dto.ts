import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class OtpVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}
