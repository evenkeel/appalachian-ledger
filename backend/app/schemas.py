from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .money import decimal, rate_decimal, to_minor, original


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(StrictModel):
    username: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=1, max_length=200)


class AccountInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal[
        "bitcoin_wallet",
        "checking",
        "savings",
        "cash",
        "brokerage",
        "credit_card",
        "loan",
        "mortgage",
        "real_estate",
        "vehicle",
        "stock",
        "etf",
        "other_asset",
        "other_liability",
    ]
    currency: Literal["USD", "BITCOIN"]
    opening_balance: str = "0"
    date: date


class AccountUpdate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    archived: bool = False
    exclude_from_consumer_debt: bool | None = None
    exclude_from_liquid_usd: bool | None = None


class CategoryInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["income", "expense"]

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class SpendingTypeInput(StrictModel):
    spending_type: Literal["fixed", "essential", "discretionary", "unclassified"]


class TransactionInput(StrictModel):
    date: date
    kind: Literal["income", "expense", "transfer"]
    account_id: int
    amount: str
    destination_id: int | None = None
    destination_amount: str | None = None
    category_id: int | None = None
    description: str = Field(min_length=1, max_length=500)
    notes: str = Field(default="", max_length=4000)


class AdjustmentInput(StrictModel):
    date: date
    amount: str
    description: str = Field(min_length=3, max_length=500)


class RateInput(StrictModel):
    day: date
    usd_per_btc: str

    @field_validator("usd_per_btc")
    @classmethod
    def validate_rate(cls, value):
        return str(rate_decimal(value))


class BudgetInput(StrictModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    category_id: int
    amount: str | None = None
    currency: Literal["USD", "BITCOIN"] = "USD"
    scope: Literal["native", "all"] = "native"
    # Compatibility with the initial bitcoin-equivalent budget API.
    bitcoin: str | None = None


class BudgetCopyInput(StrictModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class AssetInput(StrictModel):
    account_id: int
    quantity: str = "1"

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, value):
        if decimal(value) <= 0:
            raise ValueError("Quantity must be positive")
        return str(decimal(value))


class ValuationInput(StrictModel):
    date: date
    value: str


class DebtLimits(StrictModel):
    low: str
    medium: str
    high: str

    @field_validator("low", "medium", "high")
    @classmethod
    def validate_amount(cls, value):
        amount = to_minor(value, "USD")
        if amount < 0:
            raise ValueError("Debt levels must be zero or positive")
        return original(amount, "USD")

    @model_validator(mode="after")
    def ordered(self):
        if not decimal(self.low) < decimal(self.medium) < decimal(self.high):
            raise ValueError("Set Low below Medium, and Medium below High")
        return self


CardScope = Literal["accounts", "assets", "bills", "overview-balances"]


class CardOrderInput(StrictModel):
    scope: CardScope
    ids: list[str] = Field(max_length=2000)

    @field_validator("ids")
    @classmethod
    def unique_ids(cls, value):
        if len(value) != len(set(value)) or any(not item or len(item) > 80 for item in value):
            raise ValueError("Card IDs must be unique and valid")
        return value


class MonetaryLensInput(StrictModel):
    denomination: Literal["BITCOIN", "BTC", "USD"]


class PayeeRulePreference(StrictModel):
    match: str = Field(min_length=1, max_length=80)
    category_id: int
    account_id: int | None = None


class Preferences(StrictModel):
    denomination: Literal["BITCOIN", "BTC", "USD"] = "USD"
    theme: Literal["dark", "light"] = "dark"
    rate_source: Literal["manual", "coinbase", "coingecko"] = "manual"
    automatic_prices: bool = False
    debt_limits: DebtLimits | None = None
    card_orders: dict[CardScope, list[str]] = Field(default_factory=dict)
    category_payment_defaults: dict[int, int] = Field(default_factory=dict)
    payee_rules: list[PayeeRulePreference] = Field(default_factory=list)


class PaymentDefaultsInput(StrictModel):
    category_payment_defaults: dict[int, int] = Field(max_length=2000)


class HistorySyncInput(StrictModel):
    start: date | None = None


class ConversionItem(StrictModel):
    entry_id: int
    rate_id: int


class ConversionInput(StrictModel):
    items: list[ConversionItem] = Field(min_length=1, max_length=500)


class PasswordInput(StrictModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=200)


class BackupInput(StrictModel):
    passphrase: str = Field(min_length=12, max_length=200)


class WalletInput(StrictModel):
    account_id: int
    wallet: str = Field(min_length=1, max_length=120)


class HoldingInput(StrictModel):
    symbol: str = Field(min_length=1, max_length=15, pattern=r"^[A-Z0-9][A-Z0-9.\-^=]{0,14}$")
    shares: str
    cost_basis: str | None = None

    @field_validator("symbol", mode="before")
    @classmethod
    def normalize_symbol(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("shares")
    @classmethod
    def validate_shares(cls, value):
        quantity = decimal(value)
        if quantity <= 0 or quantity > 1_000_000_000 or quantity.as_tuple().exponent < -8:
            raise ValueError("Shares must be positive, at most one billion, with up to eight decimals")
        return format(quantity, "f")


class PortfolioInput(StrictModel):
    cash: str = "0"
    holdings: list[HoldingInput] = Field(max_length=25)


class RecurringBillInput(StrictModel):
    transaction: TransactionInput
    frequency: Literal["once", "weekly", "monthly", "quarterly", "semiannual", "yearly"] = "monthly"
    record_now: bool = False

    @model_validator(mode="after")
    def expense_only(self):
        if self.transaction.kind != "expense":
            raise ValueError("Recurring bills must be expenses")
        if self.transaction.destination_id or self.transaction.destination_amount:
            raise ValueError("Recurring bills cannot have a destination")
        return self


class BillPaymentInput(StrictModel):
    due_date: date
    date: date
    amount: str


class PaymentInput(StrictModel):
    account_id: int
    date: date
    amount: str
    interest: str = "0"
    category_id: int | None = None
    notes: str = Field(default="", max_length=4000)
