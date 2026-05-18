'use strict';

const { AppError, NotFoundError, ForbiddenError, ValidationError } = require('../../middleware/errors');

describe('middleware/errors', () => {
  describe('AppError', () => {
    it('should set message and statusCode', () => {
      const err = new AppError('something broke', 418);
      expect(err.message).toBe('something broke');
      expect(err.statusCode).toBe(418);
    });

    it('should set name to constructor name', () => {
      const err = new AppError('test', 500);
      expect(err.name).toBe('AppError');
    });

    it('should be instanceof Error', () => {
      const err = new AppError('test', 500);
      expect(err).toBeInstanceOf(Error);
    });

    it('should be instanceof AppError', () => {
      const err = new AppError('test', 500);
      expect(err).toBeInstanceOf(AppError);
    });
  });

  describe('NotFoundError', () => {
    it('should use default message "Resource not found"', () => {
      const err = new NotFoundError();
      expect(err.message).toBe('Resource not found');
      expect(err.statusCode).toBe(404);
    });

    it('should accept custom message', () => {
      const err = new NotFoundError('User not found');
      expect(err.message).toBe('User not found');
      expect(err.statusCode).toBe(404);
    });

    it('should set name to "NotFoundError"', () => {
      const err = new NotFoundError();
      expect(err.name).toBe('NotFoundError');
    });

    it('should be instanceof AppError and Error', () => {
      const err = new NotFoundError();
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ForbiddenError', () => {
    it('should use default message "Access denied"', () => {
      const err = new ForbiddenError();
      expect(err.message).toBe('Access denied');
      expect(err.statusCode).toBe(403);
    });

    it('should accept custom message', () => {
      const err = new ForbiddenError('Insufficient permissions');
      expect(err.message).toBe('Insufficient permissions');
      expect(err.statusCode).toBe(403);
    });

    it('should set name to "ForbiddenError"', () => {
      const err = new ForbiddenError();
      expect(err.name).toBe('ForbiddenError');
    });

    it('should be instanceof AppError and Error', () => {
      const err = new ForbiddenError();
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ValidationError', () => {
    it('should use default message "Invalid input"', () => {
      const err = new ValidationError();
      expect(err.message).toBe('Invalid input');
      expect(err.statusCode).toBe(400);
    });

    it('should accept custom message', () => {
      const err = new ValidationError('Email is required');
      expect(err.message).toBe('Email is required');
      expect(err.statusCode).toBe(400);
    });

    it('should set name to "ValidationError"', () => {
      const err = new ValidationError();
      expect(err.name).toBe('ValidationError');
    });

    it('should be instanceof AppError and Error', () => {
      const err = new ValidationError();
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('instanceof chain', () => {
    it('all subclasses should be instanceof Error and AppError', () => {
      const errors = [
        new NotFoundError(),
        new ForbiddenError(),
        new ValidationError()
      ];
      for (const err of errors) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
      }
    });
  });
});
