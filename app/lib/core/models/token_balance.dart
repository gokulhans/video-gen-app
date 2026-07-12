import 'package:equatable/equatable.dart';

/// `GET /tokens/balance` response.
class TokenBalance extends Equatable {
  const TokenBalance({required this.tokens});

  final int tokens;

  factory TokenBalance.fromJson(Map<String, dynamic> json) =>
      TokenBalance(tokens: (json['tokens'] as num?)?.toInt() ?? 0);

  @override
  List<Object?> get props => [tokens];
}

/// One row from `token_transactions`, returned by `GET /tokens/history`.
class TokenTransaction extends Equatable {
  const TokenTransaction({
    required this.id,
    required this.amount,
    required this.type,
    required this.description,
    this.projectId,
    required this.createdAt,
  });

  final String id;
  final int amount; // + credit, - debit
  final String type;
  final String description;
  final String? projectId;
  final DateTime createdAt;

  factory TokenTransaction.fromJson(Map<String, dynamic> json) =>
      TokenTransaction(
        id: json['id'] as String,
        amount: (json['amount'] as num?)?.toInt() ?? 0,
        type: json['type'] as String? ?? '',
        description: json['description'] as String? ?? '',
        projectId: json['projectId'] as String?,
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          (json['createdAt'] as num?)?.toInt() ?? 0,
        ),
      );

  @override
  List<Object?> get props => [
    id,
    amount,
    type,
    description,
    projectId,
    createdAt,
  ];
}

/// `GET /tokens/cost-estimate?templateId&duration` response — an itemized
/// breakdown shown to the user before they spend tokens on generation.
class CostEstimate extends Equatable {
  const CostEstimate({required this.total, required this.breakdown});

  final int total;
  final Map<String, int> breakdown; // action -> cost

  factory CostEstimate.fromJson(Map<String, dynamic> json) {
    final rawBreakdown = json['breakdown'] as Map<String, dynamic>? ?? {};
    return CostEstimate(
      total:
          (json['total'] as num?)?.toInt() ??
          (json['generationTotal'] as num?)?.toInt() ??
          0,
      breakdown: Map<String, int>.fromEntries(
        rawBreakdown.entries
            .where((entry) => entry.value is num)
            .map((entry) => MapEntry(entry.key, (entry.value as num).toInt())),
      ),
    );
  }

  @override
  List<Object?> get props => [total, breakdown];
}
