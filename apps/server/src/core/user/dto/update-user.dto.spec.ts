import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

describe('UpdateUserDto', () => {
  it('does not accept email through the generic user update contract', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      name: 'Updated name',
      email: 'bypass@example.test',
      confirmPassword: 'password-value',
    });

    await expect(validate(dto, { whitelist: true })).resolves.toEqual([]);
    expect(dto).toEqual(expect.objectContaining({ name: 'Updated name' }));
    expect(dto).not.toHaveProperty('email');
    expect(dto).not.toHaveProperty('confirmPassword');
  });
});
