// This file is used when NOT running on the web.
// It provides dummy classes/types to satisfy the compiler.

class WindowBase {
  void close() {}
  Location? get location => null;
}

class Location {
  set href(String value) {}
}

class Blob {
  final List<dynamic> blobParts;
  final String? type;
  Blob(this.blobParts, [this.type]);
}

class FileReader {
  // Add members as needed to satisfy the mobile compiler
  // We won't actually use these on mobile, so simple stubs work.
  dynamic result;
  Stream<dynamic> get onLoadEnd => const Stream.empty();
  Stream<dynamic> get onError => const Stream.empty();
  void readAsText(Blob blob) {}
}

// Dummy Url class
class Url {
  static String createObjectUrlFromBlob(Blob blob) => '';
  static void revokeObjectUrl(String url) {}
}

// Dummy AnchorElement
class AnchorElement {
  String? href;
  String? download;
  String? target;
  AnchorElement({this.href});
  void click() {}
}

// Dummy HttpRequest (if referenced explicitly)
class HttpRequest {
  void open(String method, String url) {}
  void setRequestHeader(String header, String value) {}
  String responseType = '';
  void send() {}
  Stream<dynamic> get onLoadEnd => const Stream.empty();
  Stream<dynamic> get onError => const Stream.empty();
  int status = 0;
  dynamic response;
}
