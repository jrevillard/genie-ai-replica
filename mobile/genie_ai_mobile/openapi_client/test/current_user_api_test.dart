//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

import 'package:openapi/api.dart';
import 'package:test/test.dart';


/// tests for CurrentUserApi
void main() {
  // final instance = CurrentUserApi();

  group('tests for CurrentUserApi', () {
    // Get user context for AI enrichment
    //
    // Returns a sanitized subset of user data for OPEA AI context enrichment. User is resolved from the JWT.
    //
    //Future apiMeContextGet() async
    test('test apiMeContextGet', () async {
      // TODO
    });

    // Delete user account (GDPR right to erasure)
    //
    // Deletes the user from Keycloak and erases all PII from ArangoDB (soft-delete with nullification). This action is irreversible.
    //
    //Future apiMeDeletePost() async
    test('test apiMeDeletePost', () async {
      // TODO
    });

    // Get current user profile
    //
    // Returns the full profile of the authenticated user. User is resolved from the JWT — no ID parameter needed.
    //
    //Future apiMeGet() async
    test('test apiMeGet', () async {
      // TODO
    });

    // Update current user profile
    //
    // Self-service profile update. JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB.
    //
    //Future apiMePut({ String data, List<MultipartFile> files }) async
    test('test apiMePut', () async {
      // TODO
    });

    // Reset user profile data
    //
    // Resets the authenticated user's profile data while preserving essential account information (credentials, email, creation date). JIT-provisioned fields (name, roles) are restored on next login.
    //
    //Future apiMeResetDataPost() async
    test('test apiMeResetDataPost', () async {
      // TODO
    });

  });
}
