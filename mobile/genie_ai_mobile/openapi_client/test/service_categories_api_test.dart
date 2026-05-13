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


/// tests for ServiceCategoriesApi
void main() {
  // final instance = ServiceCategoriesApi();

  group('tests for ServiceCategoriesApi', () {
    // Get category with services
    //
    // Retrieves a specific service category with its associated services
    //
    //Future<ApiServiceCategoriesCategoriesGet200ResponseInner> apiServiceCategoriesCategoriesCategoryIdGet(String categoryId, { String locale }) async
    test('test apiServiceCategoriesCategoriesCategoryIdGet', () async {
      // TODO
    });

    // Get all categories with detailed services for admin
    //
    // Retrieves all categories with their associated services as objects (including keys)
    //
    //Future apiServiceCategoriesCategoriesDetailedGet({ String locale }) async
    test('test apiServiceCategoriesCategoriesDetailedGet', () async {
      // TODO
    });

    // Get all categories with services
    //
    // Retrieves all service categories with their associated services
    //
    //Future<List<ApiServiceCategoriesCategoriesGet200ResponseInner>> apiServiceCategoriesCategoriesGet({ String locale }) async
    test('test apiServiceCategoriesCategoriesGet', () async {
      // TODO
    });

    // Delete a category
    //
    // Deletes a service category and its associated services
    //
    //Future apiServiceCategoriesCategoryIdDelete(String categoryId) async
    test('test apiServiceCategoriesCategoryIdDelete', () async {
      // TODO
    });

    // Update an existing category
    //
    // Updates a category's name and translations
    //
    //Future apiServiceCategoriesCategoryIdPut(String categoryId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest) async
    test('test apiServiceCategoriesCategoryIdPut', () async {
      // TODO
    });

    // Create a new service for a category
    //
    // Creates a new service with translations under a specific category
    //
    //Future apiServiceCategoriesCategoryIdServicesPost(String categoryId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest) async
    test('test apiServiceCategoriesCategoryIdServicesPost', () async {
      // TODO
    });

    // Get all translations for a category
    //
    // Retrieves all available translations for a specific service category
    //
    //Future<List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>> apiServiceCategoriesCategoryIdTranslationsGet(String categoryId) async
    test('test apiServiceCategoriesCategoryIdTranslationsGet', () async {
      // TODO
    });

    // Initialize default categories
    //
    // Initializes the system with default categories and services
    //
    //Future<ApiServiceCategoriesInitPost200Response> apiServiceCategoriesInitPost() async
    test('test apiServiceCategoriesInitPost', () async {
      // TODO
    });

    // Create a new category
    //
    // Creates a new service category with translations
    //
    //Future apiServiceCategoriesPost(ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest) async
    test('test apiServiceCategoriesPost', () async {
      // TODO
    });

    // Search categories and services
    //
    // Searches for categories and services based on a query string
    //
    //Future<ApiServiceCategoriesSearchGet200Response> apiServiceCategoriesSearchGet(String query, { String locale }) async
    test('test apiServiceCategoriesSearchGet', () async {
      // TODO
    });

    // Delete a service
    //
    // Deletes a service and its associated translations
    //
    //Future apiServiceCategoriesServicesServiceIdDelete(String serviceId) async
    test('test apiServiceCategoriesServicesServiceIdDelete', () async {
      // TODO
    });

    // Update an existing service
    //
    // Updates a service's name and its associated translations
    //
    //Future apiServiceCategoriesServicesServiceIdPut(String serviceId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest) async
    test('test apiServiceCategoriesServicesServiceIdPut', () async {
      // TODO
    });

    // Get all translations for a service
    //
    // Retrieves all available translations for a specific service
    //
    //Future apiServiceCategoriesServicesServiceIdTranslationsGet(String serviceId) async
    test('test apiServiceCategoriesServicesServiceIdTranslationsGet', () async {
      // TODO
    });

  });
}
