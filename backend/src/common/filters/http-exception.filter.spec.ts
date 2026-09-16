import { HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { HttpExceptionFilter } from './http-exception.filter';

function mockHost(exceptionIgnored?: unknown) {
  void exceptionIgnored;
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const request = { method: 'GET', path: '/products' };
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    },
    json,
    response,
  };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('replaces ThrottlerException copy with a customer-facing 429 message', () => {
    const { host, json, response } = mockHost();
    filter.catch(new ThrottlerException(), host as never);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait a moment and try again.',
        details: [],
      },
    });
  });

  it('keeps ordinary HttpException messages unchanged', () => {
    const { host, json } = mockHost();
    filter.catch(new HttpException('Category not found', HttpStatus.NOT_FOUND), host as never);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Category not found',
        details: [],
      },
    });
  });
});
