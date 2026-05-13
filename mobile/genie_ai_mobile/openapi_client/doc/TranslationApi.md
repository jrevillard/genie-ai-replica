# openapi.api.TranslationApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiTranslateMarkdownPost**](TranslationApi.md#apitranslatemarkdownpost) | **POST** /api/translate/markdown | Translate markdown content
[**apiTranslatePost**](TranslationApi.md#apitranslatepost) | **POST** /api/translate | Translate text content


# **apiTranslateMarkdownPost**
> ApiTranslateMarkdownPost200Response apiTranslateMarkdownPost(apiTranslateMarkdownPostRequest)

Translate markdown content

Translates the text content within a markdown string from a specified source language to a specified target language, preserving the markdown structure.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = TranslationApi();
final apiTranslateMarkdownPostRequest = ApiTranslateMarkdownPostRequest(); // ApiTranslateMarkdownPostRequest | 

try {
    final result = api_instance.apiTranslateMarkdownPost(apiTranslateMarkdownPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling TranslationApi->apiTranslateMarkdownPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiTranslateMarkdownPostRequest** | [**ApiTranslateMarkdownPostRequest**](ApiTranslateMarkdownPostRequest.md)|  | 

### Return type

[**ApiTranslateMarkdownPost200Response**](ApiTranslateMarkdownPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiTranslatePost**
> ApiTranslatePost200Response apiTranslatePost(apiTranslatePostRequest)

Translate text content

Translates an array of text strings from a specified source language to a specified target language.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = TranslationApi();
final apiTranslatePostRequest = ApiTranslatePostRequest(); // ApiTranslatePostRequest | 

try {
    final result = api_instance.apiTranslatePost(apiTranslatePostRequest);
    print(result);
} catch (e) {
    print('Exception when calling TranslationApi->apiTranslatePost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiTranslatePostRequest** | [**ApiTranslatePostRequest**](ApiTranslatePostRequest.md)|  | 

### Return type

[**ApiTranslatePost200Response**](ApiTranslatePost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

